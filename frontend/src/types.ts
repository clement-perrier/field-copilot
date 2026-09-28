// Types correspondant au contrat d'API (voir API_CONTRACT.md) et à la forme des
// données lues côté backend (voir ARCHITECTURE.md pour le schéma SQL). Un seul
// endroit pour ces formes, importé par tous les composants qui en ont besoin.

export interface Expert {
  name: string;
  role: string;
}

export interface Step {
  n: number;
  title: string;
  description: string;
  video_ts: string;
  // Faux pour une étape où la détection CLIP en mode live s'est révélée peu
  // fiable (voir ChatPanel.tsx, LIVE_MODE_DECISIONS.md) — le sondage est
  // sauté et la confirmation vient du technicien plutôt que d'une détection.
  auto_detect: boolean;
}

// Réponse de GET /api/knowledge-base. Le contrat d'origine ne prévoyait que le
// manifeste (id/title/equipment/expert/session_date) pour le panneau gauche ;
// je l'ai étendu avec `diagram_type` et `steps` complets, seule façon pour le
// frontend d'avoir de quoi construire les cartes de citation (diagramme, détail
// des étapes) — voir API_CONTRACT.md, section mise à jour à l'étape 4.
export interface Tutorial {
  id: string;
  title: string;
  equipment: string;
  category: string;
  diagram_type: string;
  session_date: string;
  expert: Expert;
  steps: Step[];
  // Vrai pour un seul tutoriel (CH1) : celui-là affiche une vraie vidéo
  // (RealStepVisual) au lieu du mock canvas (StepVisual) — voir CLAUDE.md.
  has_real_video: boolean;
}

export interface Gap {
  topic: string;
  context: string | null;
  created_at: string;
}

export interface Citation {
  tutorial_id: string;
  steps: number[];
}

export interface ChatImage {
  media_type: string;
  data: string; // base64, sans le préfixe "data:...;base64,"
}

export interface ChatRequest {
  message: string;
  equipment_context?: string;
  conversation_id: string;
  image?: ChatImage;
  // Réintroduit le 28/08/2026 (voir LIVE_MODE_DECISIONS.md) : ne sert plus à
  // transporter une frame, seulement à dire au backend s'il doit répondre
  // d'un bloc (chat texte classique) ou guider étape par étape (mode live) —
  // `equipment_context` a la même forme dans les deux cas, sans ce booléen le
  // backend ne peut pas les distinguer.
  live?: boolean;
}

// Renvoyé par locate_equipment_part (voir claude_agent.py) quand une photo de
// chiller CH-12 a été mise en relation avec une pièce du catalogue.
export interface PartMatch {
  tutorial_id: string;
  part_label: string;
  image_url: string;
  video_ts: string;
}

export interface ToolCallEvent {
  tool: string;
  input: Record<string, unknown>;
}

// Renvoyé par POST /api/live/equipment-check (sondage périodique en mode
// live, voir equipment_identifier.py) — pas un événement SSE de /api/chat,
// une simple réponse JSON interrogée par ChatPanel.tsx en dehors de tout tour
// de conversation Claude.
export interface PhotoMatchCandidate {
  equipment: string;
  similarity_score: number;
}

export interface StepFound {
  tutorial_id: string;
  step_n: number;
}

export interface ToolResultEvent {
  tool: string;
  result_count: number;
  // Uniquement pour search_knowledge_base — voir API_CONTRACT.md.
  steps_found?: StepFound[];
}

export interface AnswerDeltaEvent {
  text: string;
}

export interface FinalEvent {
  answer: string;
  gap: boolean;
  citations: Citation[];
  part_match?: PartMatch;
}

export interface ErrorEvent {
  message: string;
}

// À partir d'ici : pas le contrat d'API, mais l'état interne du frontend (voir
// App.tsx) — comment un tour de conversation est représenté pendant qu'il se
// construit événement par événement, avant et après l'événement `final`.

export interface ToolActivityItem {
  tool: string;
  status: "calling" | "done";
  resultCount?: number;
  input: Record<string, unknown>;
  stepsFound?: StepFound[];
}

export type ChatMessageData =
  | { role: "user"; text: string; imageDataUrl?: string }
  | {
      role: "assistant";
      text: string;
      pending: boolean;
      gap: boolean;
      citations: Citation[];
      toolActivity: ToolActivityItem[];
      partMatch?: PartMatch;
    };
