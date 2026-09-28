import Markdown from "markdown-to-jsx";
import type { ChatMessageData, ToolActivityItem, Tutorial } from "../types";
import { CitationCard } from "./CitationCard";
import { PartMatchCard } from "./PartMatchCard";

// Libellés discrets pour les appels de tool en cours (voir DESIGN_SYSTEM.md :
// "affichage discret... pour rendre visible que le modèle va effectivement
// chercher l'information"). Nouveauté par rapport à la référence (v1 n'avait
// aucun vrai tool use à afficher) — c'est tout l'objet de l'étape 2.
const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the knowledge base",
  get_video_segment: "Retrieving the video reference",
  log_knowledge_gap: "Recording a gap",
  locate_equipment_part: "Locating the part in the photo",
};

// Rendu lisible de l'input exact envoyé au tool (ex: {query: "...", equipment:
// "TX-24"}), plus les étapes trouvées (tutorial_id + numéro) quand le résultat
// est arrivé — pour l'info-bulle au survol. Reste discret par défaut (rien ne
// change visuellement tant qu'on ne survole pas), mais permet de montrer en
// direct la requête exacte reformulée par le modèle et ce qu'elle a trouvé,
// plutôt que de devoir rebasculer sur les logs backend.
function formatTooltip(item: ToolActivityItem): string {
  const lines = Object.entries(item.input).map(([key, value]) => `${key}: ${value}`);
  if (item.stepsFound && item.stepsFound.length > 0) {
    lines.push("");
    lines.push("Steps found:");
    lines.push(...item.stepsFound.map((s) => `${s.tutorial_id} · step ${s.step_n}`));
  }
  return lines.join("\n");
}

function ToolActivityTrail({ items }: { items: ToolActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="tool-activity">
      {items.map((item, i) => {
        const label = TOOL_LABELS[item.tool] ?? item.tool;
        const suffix = item.status === "done" && item.resultCount !== undefined ? ` (${item.resultCount})` : "…";
        return (
          <span className={`step ${item.status}`} key={i} title={formatTooltip(item)}>
            {label}
            {suffix}
          </span>
        );
      })}
    </div>
  );
}

export function ChatMessage({ message, tutorialsById }: { message: ChatMessageData; tutorialsById: Record<string, Tutorial> }) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <span className="msg-role">Field technician</span>
        {message.imageDataUrl && <img className="msg-attached-image" src={message.imageDataUrl} alt="Attached photo" />}
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  return (
    <div className={`msg assistant${message.gap ? " gap" : ""}`}>
      <span className="msg-role">Field Copilot</span>
      <ToolActivityTrail items={message.toolActivity} />
      <div className="bubble">
        {/* Le modèle génère naturellement du markdown (gras, listes) — voir les
            réponses citées dans la conversation. markdown-to-jsx le rend en
            vrais éléments React (pas de dangerouslySetInnerHTML, donc pas de
            risque d'injection HTML), plutôt que d'afficher les astérisques
            littéralement comme avant. */}
        <Markdown>{message.text}</Markdown>
        {message.pending && message.text === "" && (
          <span className="typing">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      {message.gap && <div className="gap-note">⚠ Not currently covered — added to the knowledge gap list.</div>}
      {(message.citations.length > 0 || message.partMatch) && (
        <div className="cite-wrap">
          {message.citations.map((citation) => {
            const tutorial = tutorialsById[citation.tutorial_id];
            if (!tutorial) return null;
            return <CitationCard key={citation.tutorial_id} citation={citation} tutorial={tutorial} />;
          })}
          {message.partMatch && <PartMatchCard partMatch={message.partMatch} />}
        </div>
      )}
    </div>
  );
}
