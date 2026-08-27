import type { Attempt } from "./types";

/**
 * Attempt logging.
 *
 * This is the part that turns the toy from a chatbot into something that can be
 * judged. Without a record of what was asked, what came back and whether it was
 * accepted, there is no way to answer the only question that matters before
 * spending money on hardware: is the child actually engaging and improving?
 *
 * Writes go to the server when it is reachable and always to a local ring
 * buffer, so the parent view still has data in local development or when the
 * function is not deployed.
 */

const LOCAL_KEY = "english-mate-attempts";
const LOCAL_LIMIT = 500;

let currentSessionId: string | null = null;

export function sessionId() {
  if (!currentSessionId) {
    currentSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return currentSessionId;
}

function readLocal(): Attempt[] {
  try {
    const stored = window.localStorage.getItem(LOCAL_KEY);
    return stored ? (JSON.parse(stored) as Attempt[]) : [];
  } catch {
    return [];
  }
}

function appendLocal(attempt: Attempt) {
  try {
    const all = [...readLocal(), attempt].slice(-LOCAL_LIMIT);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked; the server copy is the one that matters.
  }
}

export function logAttempt(attempt: Attempt) {
  appendLocal(attempt);

  // Fire and forget: a logging round trip must never sit between the child's
  // answer and the toy's reply.
  void fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attempt),
    keepalive: true,
  }).catch(() => {
    // Offline or not deployed; the local buffer already has it.
  });
}

export type Summary = {
  attempts: number;
  accepted: number;
  acceptRate: number;
  lifelineRate: number;
  sessions: number;
  days: number;
  source: "server" | "local";
};

function summarize(attempts: Attempt[], days: number, source: Summary["source"]): Summary {
  const since = Date.now() - days * 864e5;
  const recent = attempts.filter((attempt) => attempt.ts >= since);
  const accepted = recent.filter((attempt) => attempt.accepted).length;
  const lifelines = recent.filter((attempt) => attempt.trLifeline).length;

  return {
    attempts: recent.length,
    accepted,
    acceptRate: recent.length ? accepted / recent.length : 0,
    lifelineRate: recent.length ? lifelines / recent.length : 0,
    sessions: new Set(recent.map((attempt) => attempt.sessionId)).size,
    days,
    source,
  };
}

export async function fetchSummary(days = 7): Promise<Summary> {
  try {
    const response = await fetch(`/api/attempts?days=${days}`);
    if (response.ok) {
      const data = (await response.json()) as { attempts?: Attempt[] };
      if (Array.isArray(data.attempts)) return summarize(data.attempts, days, "server");
    }
  } catch {
    // Fall through to the local buffer.
  }

  return summarize(readLocal(), days, "local");
}
