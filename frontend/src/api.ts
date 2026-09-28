// Tout ce qui parle au backend. Deux lectures simples (GET) et un flux SSE
// (POST /api/chat) — c'est le seul fichier du frontend qui connaît le format
// texte "event: ...\ndata: ...\n\n", exactement comme _sse() est le seul endroit
// du backend qui le connaît côté écriture (voir routers/chat.py).

import type {
  AnswerDeltaEvent,
  ChatImage,
  ChatRequest,
  ErrorEvent,
  FinalEvent,
  Gap,
  PhotoMatchCandidate,
  ToolCallEvent,
  ToolResultEvent,
  Tutorial,
} from "./types";

export async function fetchKnowledgeBase(): Promise<Tutorial[]> {
  const res = await fetch("/api/knowledge-base");
  if (!res.ok) throw new Error(`GET /api/knowledge-base a échoué (${res.status})`);
  return res.json();
}

export async function fetchGaps(): Promise<Gap[]> {
  const res = await fetch("/api/gaps");
  if (!res.ok) throw new Error(`GET /api/gaps a échoué (${res.status})`);
  return res.json();
}

interface ChatHandlers {
  onToolCall?: (e: ToolCallEvent) => void;
  onToolResult?: (e: ToolResultEvent) => void;
  onAnswerDelta?: (e: AnswerDeltaEvent) => void;
  onFinal?: (e: FinalEvent) => void;
  onError?: (e: ErrorEvent) => void;
}

// EventSource (l'API navigateur standard pour le SSE) ne supporte que GET, sans
// corps de requête — inutilisable ici puisque /api/chat est un POST. On relit
// donc le flux à la main : fetch() classique, puis lecture progressive du corps
// de la réponse via son ReadableStream, en découpant sur les séparateurs SSE
// ("\n\n" entre deux événements).
export async function streamChat(request: ChatRequest, handlers: ChatHandlers): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.body) throw new Error("Réponse sans corps de streaming.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      dispatchEvent(rawEvent, handlers);
    }
  }
}

// Les deux endpoints ci-dessous (voir routers/live.py) sont volontairement de
// simples requêtes JSON, pas du SSE : appelés en continu (toutes les
// quelques secondes) pendant le mode live pour détecter une transition
// automatiquement, ils ne passent jamais par Claude — un vrai tour de
// conversation (streamChat) n'est déclenché qu'une fois une transition
// confirmée par ces sondages.
export async function checkEquipment(image: ChatImage): Promise<{ candidates: PhotoMatchCandidate[] }> {
  const res = await fetch("/api/live/equipment-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  if (!res.ok) throw new Error(`POST /api/live/equipment-check a échoué (${res.status})`);
  return res.json();
}

export async function checkStepTransition(
  image: ChatImage,
  tutorialId: string,
  currentStep: number,
): Promise<{ transitioned: boolean; score?: number }> {
  const res = await fetch("/api/live/step-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, tutorial_id: tutorialId, current_step: currentStep }),
  });
  if (!res.ok) throw new Error(`POST /api/live/step-check a échoué (${res.status})`);
  return res.json();
}

function dispatchEvent(rawEvent: string, handlers: ChatHandlers): void {
  const lines = rawEvent.split("\n");
  const eventLine = lines.find((l) => l.startsWith("event:"));
  const dataLine = lines.find((l) => l.startsWith("data:"));
  if (!eventLine || !dataLine) return;

  const eventName = eventLine.slice("event:".length).trim();
  const data = JSON.parse(dataLine.slice("data:".length).trim());

  switch (eventName) {
    case "tool_call":
      handlers.onToolCall?.(data as ToolCallEvent);
      break;
    case "tool_result":
      handlers.onToolResult?.(data as ToolResultEvent);
      break;
    case "answer_delta":
      handlers.onAnswerDelta?.(data as AnswerDeltaEvent);
      break;
    case "final":
      handlers.onFinal?.(data as FinalEvent);
      break;
    case "error":
      handlers.onError?.(data as ErrorEvent);
      break;
  }
}
