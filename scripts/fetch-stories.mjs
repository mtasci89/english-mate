#!/usr/bin/env node
/*
 * Pulls real picture books from StoryWeaver (Pratham Books) into the story
 * block, instead of having a model write them.
 *
 * StoryWeaver's Level 1 books are written for children starting to read, they
 * come with a human narrator, and the narration ships with word-level timings
 * (WebVTT). That last part is what makes them usable here: every page of a
 * book maps to a slice of one MP3, so the box can play a page, stop, ask one
 * easy question, and carry on — with no text-to-speech at all for the story.
 *
 *   npm run fetch:stories -- --topic=animals
 *   npm run fetch:stories -- --topic=animals --count=2 --max-words=150
 *   npm run fetch:stories -- --slug=369-the-red-raincoat --topic=nature
 *   npm run fetch:stories -- --dry-run --topic=food
 *
 * Search and the audio files are public. Reading a book's pages is not: the
 * `/read` endpoint needs a logged-in StoryWeaver session, so the browser's
 * Cookie header goes in `.env.storyweaver` (one line, gitignored). Questions
 * are written by Gemini from `GEMINI_API_KEY` in `.env.local`; without a key
 * the story is still saved, just without questions.
 *
 * Every fetched story lands unapproved. It reaches the child only after a
 * parent has read it in the parent panel and ticked it.
 *
 * Licence: StoryWeaver content is CC BY 4.0. The attribution page of each
 * book is stored with it and shown in the parent panel; keep it if a story is
 * ever shared further.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORIES_DIR = join(ROOT, "src", "curriculum", "stories");
const SITE = "https://storyweaver.org.in";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const PAUSE_MS = 2000;

/* ---------- small helpers ---------- */

function arg(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const flag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads KEY=value lines without touching process.env for keys already set. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** The cookie file holds the raw header value, nothing else. */
function readCookie() {
  const path = join(ROOT, ".env.storyweaver");
  if (process.env.STORYWEAVER_COOKIE) return process.env.STORYWEAVER_COOKIE;
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8")
    .trim()
    .replace(/^STORYWEAVER_COOKIE=/, "")
    .replace(/^cookie:\s*/i, "")
    .replace(/^["']|["']$/g, "");
}

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** Curly quotes and the like are noise to a TTS engine and to a matcher. */
const plain = (text) =>
  decodeEntities(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .trim();

/* ---------- parsing (exported for tests) ---------- */

/**
 * WebVTT cue id -> [start, end] seconds.
 *
 * StoryWeaver's files are hand-made and loose: arrows appear as both
 * `--> ` and `-->` with no space, and the final cue often runs a full minute
 * past the last word. So this parses leniently and clamps that last cue.
 */
export function parseVtt(text) {
  const cues = new Map();
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  const time = (value) => {
    const parts = value.trim().split(":").map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };

  for (const block of blocks) {
    const rows = block.split("\n").map((row) => row.trim()).filter(Boolean);
    const timing = rows.findIndex((row) => row.includes("-->"));
    if (timing < 1) continue;
    const id = Number(rows[timing - 1]);
    if (!Number.isFinite(id)) continue;
    const [from, to] = rows[timing].split("-->");
    cues.set(id, [time(from), time(to.split(" ").filter(Boolean)[0])]);
  }

  const lastId = Math.max(...cues.keys());
  const last = cues.get(lastId);
  if (last && last[1] - last[0] > 2.5) cues.set(lastId, [last[0], last[0] + 2.5]);
  return cues;
}

/** Page html -> its words and the VTT cue ids they carry. */
export function pageWords(html) {
  const words = [];
  const pattern = /<span[^>]*data-cue="(\d+)"[^>]*>([^<]*)<\/span>/g;
  let match;
  while ((match = pattern.exec(html))) {
    words.push({ cue: Number(match[1]), text: plain(match[2]) });
  }
  return words;
}

function pageText(html) {
  const words = pageWords(html);
  if (words.length) return words.map((word) => word.text).join(" ");
  return plain(html.replace(/<[^>]+>/g, " "));
}

function pageImage(page) {
  const sizes = page.coverImage?.sizes ?? [];
  // Mid-size: sharp on a tablet, small enough to load instantly.
  return (sizes[4] ?? sizes[sizes.length - 1])?.url;
}

/**
 * A StoryWeaver read response -> the app's story shape.
 *
 * One line per book page. Each line carries its slice of the narration, so
 * the player seeks, plays to `end`, and stops — a page is the natural place
 * for a child's attention to come up for air.
 */
export function toStory(read, vttText, { topic, meta = {} }) {
  const data = read.data ?? read;
  const cues = vttText ? parseVtt(vttText) : new Map();
  const storyPages = data.pages.filter((page) => page.pageType === "StoryPage");

  const lines = storyPages
    .map((page, index) => {
      const words = pageWords(page.html);
      const timed = words.map((word) => cues.get(word.cue)).filter(Boolean);
      const line = {
        id: `p${String(index + 1).padStart(2, "0")}`,
        text: pageText(page.html),
      };
      if (timed.length) {
        line.start = Math.round(timed[0][0] * 100) / 100;
        line.end = Math.round(timed[timed.length - 1][1] * 100) / 100;
      }
      const image = pageImage(page);
      if (image) line.image = image;
      return line;
    })
    .filter((line) => line.text);

  const credits = data.pages.find((page) => page.pageType === "BackInnerCoverPage");
  const attribution = credits ? plain(credits.html.replace(/<[^>]+>/g, " ")) : "";
  const slug = data.slug ?? meta.slug;
  const title =
    meta.title ??
    attribution.match(/This story: (.+?) is written by/)?.[1]?.trim() ??
    slug.replace(/^\d+-/, "").replace(/-/g, " ");

  const timed = lines.every((line) => typeof line.start === "number");

  return {
    key: `sw-${slug}`,
    topic,
    title,
    approved: false,
    ...(timed && data.audioPath ? { audio: data.audioPath } : {}),
    source: {
      site: "StoryWeaver",
      url: `${SITE}/stories/${slug}`,
      level: data.level ?? meta.level ?? null,
      authors: (data.authors ?? meta.authors ?? []).map((person) => person.name),
      illustrators: (meta.illustrators ?? []).map((person) => person.name),
      publisher: meta.publisher?.name ?? (data.isPublisher ? "Pratham Books" : null),
      license: /CC BY 4\.0/.test(attribution) ? "CC BY 4.0" : "see attribution",
      attribution,
    },
    words: lines.reduce((sum, line) => sum + line.text.split(" ").length, 0),
    lines,
    questions: [],
  };
}

/* ---------- network ---------- */

const browserHeaders = {
  accept: "application/json, text/plain, */*",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

async function getJson(url, cookie) {
  const response = await fetch(url, {
    headers: { ...browserHeaders, ...(cookie ? { cookie } : {}) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${response.status} from ${url.split("?")[0]} — the StoryWeaver cookie is missing or expired. ` +
        "Log in again in the browser and refresh .env.storyweaver.",
    );
  }
  if (!response.ok) throw new Error(`${response.status} from ${url.split("?")[0]}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  // The files are UTF-8 but some were saved through a Latin-1 editor; the
  // timings are all that is read from them, so mojibake in words is harmless.
  return response.text();
}

async function search(query, perPage) {
  const params = new URLSearchParams({ query, per_page: String(perPage) });
  params.append("languages[]", "English");
  params.append("levels[]", "1");
  const json = await getJson(`${SITE}/api/v1/books-search?${params}`);
  return json.data ?? json.books ?? json.results ?? [];
}

/** Recommended and well-liked first; Pratham's own books are edited and narrated. */
function rank(book) {
  return (
    (book.recommended ? 1000 : 0) +
    (book.editorsPick ? 800 : 0) +
    (book.publisher?.name === "Pratham Books" ? 500 : 0) +
    Math.min(400, (book.likesCount ?? 0) / 5) +
    Math.min(200, (book.readsCount ?? 0) / 5000)
  );
}

/* ---------- questions ---------- */

async function writeQuestions(story) {
  const key = process.env.GEMINI_API_KEY || process.env.GoogleGeminiKey;
  if (!key) {
    console.warn("  no GEMINI_API_KEY — saved without questions");
    return [];
  }

  const pages = story.lines.map((line) => `${line.id}: ${line.text}`).join("\n");
  const prompt = `You write listening-check questions for a 6-year-old Turkish child who is just beginning English.
The child hears this picture book page by page:

${pages}

Write exactly 3 questions. Rules:
- Each question is asked right after one page ("after" = that page id). Use 3 different pages, spread through the book; never the last page.
- The answer ("target") is ONE simple English word that is said on that page or an earlier one: a concrete noun, colour or number a child can say. Lowercase, no punctuation.
- The question is at most 7 very simple words, present tense if possible ("What colour is the coat?", "Who is in the tree?").
- "distractors": 3 other single simple words of the same kind, none equal to the target.
- "trHelp": the question in natural, simple Turkish for a child.
Return JSON: {"questions":[{"after":"p02","text":"...","target":"...","distractors":["...","...","..."],"trHelp":"..."}]}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    console.warn(`  questions skipped: ${GEMINI_MODEL} answered ${response.status}`);
    return [];
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("  questions skipped: the model did not return JSON");
    return [];
  }

  return validQuestions(story, parsed.questions ?? []);
}

/** Keeps only questions the matcher can actually score. */
export function validQuestions(story, raw) {
  const pageIds = story.lines.map((line) => line.id);
  const lastPage = pageIds[pageIds.length - 1];
  const single = (value) => typeof value === "string" && /^[a-z]+$/.test(value.trim().toLowerCase());
  const used = new Set();
  const kept = [];

  for (const item of raw) {
    if (!item || !pageIds.includes(item.after) || item.after === lastPage || used.has(item.after)) continue;
    const target = String(item.target ?? "").trim().toLowerCase();
    if (!single(target)) continue;
    const heardSoFar = story.lines
      .slice(0, pageIds.indexOf(item.after) + 1)
      .map((line) => line.text.toLowerCase())
      .join(" ");
    if (!new RegExp(`\\b${target}`).test(heardSoFar)) continue;
    const distractors = (item.distractors ?? [])
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => single(value) && value !== target)
      .slice(0, 3);
    if (distractors.length < 2 || !item.text || !item.trHelp) continue;

    used.add(item.after);
    kept.push({
      id: `q${kept.length + 1}`,
      after: item.after,
      text: String(item.text).trim(),
      target,
      distractors,
      trHelp: String(item.trHelp).trim(),
    });
  }

  return kept.sort((a, b) => pageIds.indexOf(a.after) - pageIds.indexOf(b.after));
}

/* ---------- main ---------- */

async function fetchOne(slug, cookie, topic, meta) {
  const read = await getJson(`${SITE}/api/v1/stories/${slug}/read?ignore_count=true&source=`, cookie);
  const data = read.data ?? read;
  const vtt = data.vttFilePath ? await getText(data.vttFilePath).catch(() => "") : "";
  return toStory(read, vtt, { topic, meta });
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));

  const topics = JSON.parse(readFileSync(join(ROOT, "src", "curriculum", "topics.json"), "utf8"));
  const topicKey = arg("topic");
  const topic = topics.find((item) => item.key === topicKey);
  if (!topic) {
    console.error(`--topic is required: ${topics.map((item) => item.key).join(", ")}`);
    process.exit(1);
  }

  const count = Number(arg("count", "3"));
  const maxWords = Number(arg("max-words", "200"));
  const dryRun = flag("dry-run");
  const slug = arg("slug");
  const existing = new Set(readdirSync(STORIES_DIR).filter((name) => name.endsWith(".json")));

  // Searching is public, so a dry run needs no cookie: it shows what would be
  // read, which is the cheap way to judge a topic before touching anything.
  let candidates;
  if (slug) {
    candidates = [{ slug, title: slug }];
  } else {
    const queries = arg("query")?.split(",") ?? [topic.en.split(" ")[0], ...topic.words.slice(0, 4)];
    const seen = new Map();
    for (const query of queries) {
      for (const book of await search(query, 20)) {
        if (book.slug && !seen.has(book.slug)) seen.set(book.slug, book);
      }
      await sleep(PAUSE_MS / 2);
    }
    candidates = [...seen.values()]
      .filter((book) => !existing.has(`sw-${book.slug}.json`))
      .sort((a, b) => rank(b) - rank(a));
    console.log(`${candidates.length} new Level 1 books for "${topic.en}" (${queries.join(", ")})`);
  }

  if (dryRun) {
    for (const book of candidates.slice(0, 15)) {
      const tags = [book.recommended && "recommended", book.editorsPick && "editor's pick", book.publisher?.name]
        .filter(Boolean)
        .join(", ");
      console.log(`  ${book.slug}  —  ${book.title}${tags ? `  [${tags}]` : ""}`);
    }
    return;
  }

  const cookie = readCookie();
  if (!cookie) {
    console.error("No StoryWeaver cookie. Put the browser's Cookie header in .env.storyweaver (see README).");
    process.exit(1);
  }

  let saved = 0;
  for (const book of candidates) {
    if (saved >= count) break;
    process.stdout.write(`- ${book.slug} … `);
    try {
      const story = await fetchOne(book.slug, cookie, topic.key, book);
      if (!story.audio) {
        console.log("no narration, skipped");
      } else if (!slug && story.words > maxWords) {
        console.log(`${story.words} words (> ${maxWords}), skipped`);
      } else {
        story.questions = await writeQuestions(story);
        writeFileSync(join(STORIES_DIR, `${story.key}.json`), `${JSON.stringify(story, null, 2)}\n`);
        console.log(`saved: "${story.title}", ${story.lines.length} pages, ${story.words} words, ${story.questions.length} questions`);
        saved += 1;
      }
    } catch (error) {
      console.log(`failed: ${error.message}`);
      if (/cookie/.test(error.message)) process.exit(1);
    }
    await sleep(PAUSE_MS);
  }

  console.log(
    saved
      ? `\n${saved} stor${saved === 1 ? "y" : "ies"} saved, unapproved. Next: npm run build:audio (for the questions), then read and approve them in the parent panel.`
      : "\nNothing saved. Try --max-words=300 or another --query.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
