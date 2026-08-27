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
    "Reply in simple spoken English, usually one or two short sentences.",
    "Ask one natural follow-up question when it helps the conversation continue.",
    "If the child makes an English mistake, do not lecture. Recast the idea naturally in correct English and keep talking.",
    "Avoid classroom wording such as correction, repeat after me, today's lesson, exercise, grammar, score, or homework.",
    turkishBridge
      ? "If the child uses Turkish or seems stuck, briefly understand them in Turkish, then offer one easy English phrase and continue gently."
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
      maxOutputTokens: 90,
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
  const text = extractText(data);

  if (!text) {
    return json(502, {
      error: "Gemini returned an empty response",
    });
  }

  return json(200, { text, lang: /[çğıöşü]/i.test(text) ? "tr" : "en" });
}
