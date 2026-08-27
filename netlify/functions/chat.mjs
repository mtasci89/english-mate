const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

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
    "Ask at most one short, easy follow-up question, and only when it keeps the conversation going.",
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

  const lastBreak = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  return lastBreak > 20 ? text.slice(0, lastBreak + 1) : text;
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(500, {
      error: "GEMINI_API_KEY is not configured in Netlify environment variables.",
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

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const payload = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(request.settings) }],
    },
    contents: toGeminiContents(request.messages, latestText),
    generationConfig: {
      temperature: 0.75,
      topP: 0.9,
      maxOutputTokens: 120,
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
      error: "Gemini request failed",
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

  return json(200, { text, lang: detectLanguage(text) });
}
