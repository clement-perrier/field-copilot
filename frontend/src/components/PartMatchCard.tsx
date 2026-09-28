import type { PartMatch } from "../types";

// Pendant de CitationCard.tsx, mais pour locate_equipment_part plutôt que
// get_video_segment : une seule image (déjà annotée d'un cercle, voir
// backend/scripts/extract_frames.py), pas de diagramme ni de liste d'étapes —
// ce n'est pas la citation d'un tutoriel, juste le repérage d'une pièce.
export function PartMatchCard({ partMatch }: { partMatch: PartMatch }) {
  return (
    <div className="cite-card bracket part-match-card">
      <div className="bl" />
      <div className="br" />
      <div className="cite-head">
        <span className="cite-title">{partMatch.part_label}</span>
        <span className="cite-id">{partMatch.tutorial_id}</span>
      </div>
      <img src={partMatch.image_url} alt={partMatch.part_label} />
      <div className="step-visual-caption">{partMatch.video_ts} · real footage, reused for demo</div>
    </div>
  );
}
