const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

/*
 * A ceiling, not a length control.
 *
 * Gemini 2.5 and 3 models spend thinking tokens out of this same budget, so a
 * tight cap left nothing for the visible reply and answers arrived cut off
 * mid-word ("Hello! How are"). Reply length is governed by the prompt — twenty
 * words — and this only has to be roomy enough that thinking cannot crowd the
 * answer out. Gemini 3 Flash does not support turning thinking off, so headroom
 * is the reliable fix rather than thinkingConfig.
 */
const MAX_OUTPUT_TOKENS = 800;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function buildSystemPrompt(settings = {}) {
  const level = settings.level ?? "sentence";
  const topic = settings.topic ?? "daily";
  const correctionStyle = settings.correctionStyle ?? "gentle";
  const childName = settings.childName || "the child";
  const turkishBridge = settings.turkishBridge !== false;

  return [
    "You are English Mate, a warm spoken-English friend for a child.",
    "Your job is natural conversation, not a formal lesson.",
    `Child label: ${childName}. Level: ${level}. Topic preference: ${topic}.`,
    `Correction style: ${correctionStyle}.`,
    // The listener is six and roughly ten weeks into English. Anything longer
    // or rarer than this is heard as noise, and a reply the child cannot parse
    // ends the conversation just as surely as no reply at all.
    "The child is six years old and a beginner in English.",
    "Reply with one or two very short sentences. Never go past twenty words in total.",
    "Use only common, concrete, everyday words a beginner would already know. No idioms, no phrasal verbs, no rare vocabulary.",
    "Prefer the present tense and simple sentence shapes.",
    // What made the conversation feel canned: an acknowledgement that fits any
    // answer, followed by a question from a fixed rotation. Both are banned.
    // Two different things get confused here. Filler that would fit any input
    // is dead weight; the set replies a greeting or a "how are you" calls for
    // are the exact patterns a beginner is here to learn, and must be used.
    "Never open with filler that would fit whatever the child had said. Do not say I understand, I see, that's nice, or that's interesting.",
    "But when the child uses a social routine, answer with the ordinary routine reply and hand it straight back. \"How are you?\" gets \"I'm fine, thank you. And you?\" — not a statement about your mood. Greetings get greetings, thank you gets you're welcome.",
    "React to the specific thing the child just said: name it back, or say something true about it, so it is obvious you listened.",
    // Without this the toy answers and stops, and a beginner has nothing to
    // offer next — the conversation dies on the toy's turn, not the child's.
    "Always end your reply with something the child can answer: a short question, or the same question handed back. Never end on a statement that leaves nothing to say.",
    "Ask at most one short, easy question, and make it about what the child just told you.",
    "Never repeat a question you have already asked in this conversation. Look at the messages above and ask about something new.",
    "If the child gives a one-word answer, say the whole sentence they meant, then ask the next thing.",
    // The single most useful moment in the conversation: a Turkish word inside
    // an English sentence is the child pointing at the exact word they are
    // missing. Supplying it is worth more than any question could be.
    "When the child drops a Turkish word into an English sentence, they are showing you a word they do not have yet. Give it to them warmly and in passing: \"Mısır is corn, and biber is pepper!\" Then say their whole sentence back in correct English — \"So you like cheese, corn and pepper!\" — and carry on.",
    "Do this for every Turkish word in the sentence, never just the first one, and never stop the conversation to teach. It is one cheerful line, not a lesson.",
    // The recogniser is set to English, so Turkish words arrive mangled.
    "Turkish words may reach you misspelled, because the microphone is listening for English. Work out what the child meant and answer that, rather than repeating the misspelling back.",
    "If the child makes an English mistake, do not lecture. Recast the idea naturally in correct English and keep talking.",
    "Avoid classroom wording such as correction, repeat after me, today's lesson, exercise, grammar, score, or homework.",
    turkishBridge
      ? "If the child uses Turkish or seems stuck, answer the meaning in one short Turkish sentence, then immediately give one easy English phrase for them to use. Always end your reply in English, never in Turkish."
      : "Keep the conversation in English.",
    "Never discuss unsafe, adult, violent, sexual, hateful, political persuasion, or self-harm content. Redirect warmly to ordinary child-safe topics.",
  ].join("\n");
}

function toGeminiContents(messages = [], latestText = "") {
  const safeMessages = messages.slice(-8).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: String(message.text ?? "").slice(0, 800) }],
  }));

  safeMessages.push({
    role: "user",
    parts: [{ text: String(latestText).slice(0, 800) }],
  });

  return safeMessages;
}

function extractText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join(" ")
      .trim() || ""
  );
}

/**
 * Drops a trailing half-sentence when generation stopped at the token cap.
 * Speaking a sentence that ends mid-word is worse than saying slightly less.
 */
function trimToCompleteSentence(text, finishReason) {
  if (finishReason !== "MAX_TOKENS") return text;

  // Any complete sentence beats a fragment: "Hello!" is a usable reply, "Hello!
  // How are" is not. Only text with no sentence end at all is passed through.
  const lastBreak = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  return lastBreak >= 0 ? text.slice(0, lastBreak + 1) : text;
}

const TURKISH_HINTS =
  /\b(bir|bu|ve|için|çok|nasıl|ne|değil|var|yok|şey|iyi|güzel|evet|hayır|şimdi|sonra|demek|söyle)\b/gi;

/**
 * Picks the voice for the whole reply.
 *
 * Deciding by "contains a Turkish letter" made a fully English sentence holding
 * one Turkish word get read start to finish by the Turkish voice. The reply is
 * called Turkish only when Turkish markers dominate, and ties go to English —
 * the language being taught, and the far less jarring wrong guess.
 */
function detectLanguage(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return "en";

  const diacritics = (text.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
  const hints = (text.match(TURKISH_HINTS) || []).length;

  return (diacritics + hints * 2) / words.length > 0.5 ? "tr" : "en";
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // GoogleGeminiKey is accepted because that is what the deployment already
  // called it. A name mismatch here fails the request, the client falls back to
  // canned replies, and the whole conversation quietly stops using the model —
  // a failure worth being generous about rather than strict.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GoogleGeminiKey;
  if (!apiKey) {
    return json(500, {
      error: "No Gemini key configured. Set GEMINI_API_KEY (or GoogleGeminiKey).",
    });
  }

  let request;
  try {
    request = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const latestText = String(request.text ?? "").trim();
  if (!latestText) {
    return json(400, { error: "Missing text" });
  }

  /*
   * Translate mode backs the Turkish lifeline in free chat.
   *
   * The lifeline used to say "Şöyle sordum:" and then repeat the same English
   * sentence, which explains nothing — the child who did not understand it the
   * first time does not understand it the second. Now the sentence is actually
   * rendered into Turkish before the English is repeated.
   */
  // gemini-2.0-flash was shut down on 1 June 2026, so every call 404'd and the
  // client fell back to canned replies. Model IDs retire on a schedule; when
  // this one goes, the error below names it, and GEMINI_MODEL overrides it
  // without a code change.
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const translating = request.mode === "translate";

  /*
   * Gap mode: which words did the child reach for in Turkish?
   *
   * A Turkish word inside an English sentence is proof of a specific missing
   * word — better evidence of what to teach next than any curriculum ordering.
   * This runs after the reply has already been spoken, so it costs the child
   * nothing, and its output seeds the Name It deck.
   */
  const findingGaps = request.mode === "gaps";
  if (findingGaps) {
    const gapPayload = {
      systemInstruction: {
        parts: [
          {
            text: [
              "The sentence comes from a Turkish child speaking English. Some words may be Turkish, possibly misspelled because the microphone was listening for English.",
              "List only the words the child said in Turkish instead of English.",
              'Reply with a JSON array like [{"tr":"mısır","en":"corn"}] and nothing else.',
              "Use the correct Turkish spelling in tr, and the single most ordinary English word in en.",
              "If every word was already English, reply with [].",
            ].join("\n"),
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: latestText }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
      },
    };

    const gapResponse = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(gapPayload),
    });

    if (!gapResponse.ok) return json(200, { gaps: [] });

    const gapData = await gapResponse.json();
    let gaps = [];
    try {
      const parsed = JSON.parse(extractText(gapData));
      if (Array.isArray(parsed)) {
        gaps = parsed
          .filter((gap) => gap && typeof gap.tr === "string" && typeof gap.en === "string")
          .map((gap) => ({ tr: gap.tr.trim().slice(0, 40), en: gap.en.trim().toLowerCase().slice(0, 40) }))
          .filter((gap) => gap.tr && gap.en)
          .slice(0, 5);
      }
    } catch {
      // A malformed list is not worth failing the turn over.
    }

    return json(200, { gaps });
  }

  const payload = translating
    ? {
        systemInstruction: {
          parts: [
            {
              text: [
                "Translate the English sentence into natural Turkish that a six-year-old understands.",
                "Reply with the Turkish translation only: no quotes, no explanation, no English.",
              ].join("\n"),
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: latestText }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
      }
    : {
        systemInstruction: {
          parts: [{ text: buildSystemPrompt(request.settings) }],
        },
        contents: toGeminiContents(request.messages, latestText),
        generationConfig: {
          // High enough that questions vary, low enough that a greeting gets
          // the conventional answer instead of an inventive one.
          temperature: 0.75,
          topP: 0.9,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      };

  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(response.status, {
      // The model ID is in the message because a retired one is the likeliest
      // cause, and it is invisible from the browser otherwise.
      error: `Gemini request failed (${response.status}) for model "${model}"`,
      detail: detail.slice(0, 500),
    });
  }

  const data = await response.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  const text = trimToCompleteSentence(extractText(data), finishReason);

  if (!text) {
    return json(502, {
      error: "Gemini returned an empty response",
    });
  }

  // A translation is Turkish by construction; the heuristic would second-guess
  // a short one that happens to carry no Turkish markers.
  return json(200, { text, lang: translating ? "tr" : detectLanguage(text) });
}
