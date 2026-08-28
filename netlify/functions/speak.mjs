/**
 * Runtime speech for free chat.
 *
 * The structured games play pre-rendered files, but a conversation cannot be
 * rendered ahead of time, so its replies fell back to the browser voice — the
 * robotic one. This proxies Cloud Text-to-Speech with the same Chirp 3 HD
 * voices the cached prompts use, so the toy sounds like one character
 * throughout instead of switching to a synthesiser mid-session.
 *
 * Billed per character, and a reply is a couple of dozen words.
 */

const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Kept in step with scripts/build-audio.mjs so the voice does not change
// between a cached prompt and a spoken reply.
const VOICE_EN = process.env.GCLOUD_VOICE_EN || "en-US-Chirp3-HD-Leda";
const VOICE_TR = process.env.GCLOUD_VOICE_TR || "tr-TR-Chirp3-HD-Aoede";
const RATE_EN = Number(process.env.GCLOUD_RATE_EN) || 0.8;
const RATE_TR = Number(process.env.GCLOUD_RATE_TR) || 1.0;

/** A spoken turn for a six-year-old is short; the cap is a cost guard. */
const MAX_CHARS = 400;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // The client falls back to the browser voice, so this is a degraded
    // experience rather than a broken one — but it is reported, not hidden.
    return json(503, { error: "GOOGLE_TTS_API_KEY is not configured." });
  }

  let request;
  try {
    request = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const text = String(request.text ?? "").trim().slice(0, MAX_CHARS);
  if (!text) return json(400, { error: "Missing text" });

  const lang = request.lang === "tr" ? "tr" : "en";

  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: lang === "tr" ? "tr-TR" : "en-US",
        name: lang === "tr" ? VOICE_TR : VOICE_EN,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: lang === "tr" ? RATE_TR : RATE_EN,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(response.status, {
      error: "Cloud TTS request failed",
      detail: detail.slice(0, 300),
    });
  }

  const data = await response.json();
  if (!data.audioContent) return json(502, { error: "Cloud TTS returned no audio" });

  return json(200, { audio: data.audioContent, format: "mp3" });
}
