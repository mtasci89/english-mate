import { getStore } from "@netlify/blobs";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const MAX_DAYS = 60;
const GAMES = new Set(["move", "nameit", "chat"]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function store() {
  // Blobs are unavailable outside a deployed Netlify context; the client keeps
  // its own local buffer, so logging degrades instead of failing.
  try {
    return getStore("attempts");
  } catch {
    return null;
  }
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function text(value, limit) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Accepts only the known shape, so a malformed client cannot poison the store. */
function sanitize(raw) {
  const sessionId = text(raw.sessionId, 64);
  const game = GAMES.has(raw.game) ? raw.game : null;
  const itemKey = text(raw.itemKey, 64);
  if (!sessionId || !game || !itemKey) return null;

  const ts = number(raw.ts);

  return {
    ts: ts && ts > 0 ? ts : Date.now(),
    sessionId,
    game,
    itemKey,
    target: text(raw.target, 64),
    heard: text(raw.heard, 200),
    accepted: raw.accepted === true,
    score: number(raw.score),
    trLifeline: raw.trLifeline === true,
    hintLevel: number(raw.hintLevel) ?? 0,
    latencyMs: number(raw.latencyMs),
  };
}

async function handlePost(event) {
  let raw;
  try {
    raw = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const attempt = sanitize(raw);
  if (!attempt) return json(400, { error: "Invalid attempt" });

  const blobs = store();
  if (!blobs) return json(200, { stored: false, reason: "blobs-unavailable" });

  // One blob per session per day. A session only ever writes from one device,
  // so this read-modify-write does not race with itself, and a week of history
  // is a handful of reads rather than one per attempt.
  const key = `${dayKey(attempt.ts)}/${attempt.sessionId}`;

  try {
    const existing = (await blobs.get(key, { type: "json" })) ?? [];
    const list = Array.isArray(existing) ? existing : [];
    list.push(attempt);
    await blobs.setJSON(key, list.slice(-2000));
    return json(200, { stored: true });
  } catch {
    return json(200, { stored: false, reason: "write-failed" });
  }
}

async function handleGet(event) {
  const requested = Number(event.queryStringParameters?.days ?? 7);
  const days = Math.min(Math.max(Number.isFinite(requested) ? requested : 7, 1), MAX_DAYS);

  const blobs = store();
  if (!blobs) return json(200, { attempts: [], source: "unavailable" });

  const wanted = new Set();
  for (let offset = 0; offset < days; offset += 1) {
    wanted.add(dayKey(Date.now() - offset * 864e5));
  }

  try {
    const attempts = [];
    for (const day of wanted) {
      const { blobs: entries } = await blobs.list({ prefix: `${day}/` });
      for (const entry of entries) {
        const list = await blobs.get(entry.key, { type: "json" });
        if (Array.isArray(list)) attempts.push(...list);
      }
    }

    attempts.sort((a, b) => a.ts - b.ts);
    return json(200, { attempts, source: "blobs" });
  } catch {
    return json(200, { attempts: [], source: "read-failed" });
  }
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod === "POST") return handlePost(event);
  if (event.httpMethod === "GET") return handleGet(event);
  return json(405, { error: "Method not allowed" });
}
