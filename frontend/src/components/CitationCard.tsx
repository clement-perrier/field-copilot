import type { Citation, Tutorial } from "../types";
import { Diagram } from "../diagrams";
import { StepVisual } from "./StepVisual";
import { RealStepVisual } from "./RealStepVisual";

// Porte la "cite-card" de la référence : coins façon viseur caméra (classe
// .bracket, voir DESIGN_SYSTEM.md), schéma à gauche, étapes citées à droite.
export function CitationCard({ citation, tutorial }: { citation: Citation; tutorial: Tutorial }) {
  const citedSteps = tutorial.steps.filter((s) => citation.steps.includes(s.n));

  return (
    <div className="cite-card bracket">
      <div className="bl" />
      <div className="br" />
      <div className="cite-head">
        <span className="cite-title">{tutorial.title}</span>
        <span className="cite-id">{tutorial.id}</span>
      </div>
      <div className="cite-expert">
        Source: {tutorial.expert.name}, {tutorial.expert.role} · session on {tutorial.session_date}
      </div>
      <div className="cite-body">
        <div>
          <Diagram type={tutorial.diagram_type} />
        </div>
        <div className="step-list">
          {citedSteps.map((s) => (
            <div className="step-row" key={s.n}>
              <span className="step-num">{s.n}</span>
              {tutorial.has_real_video ? (
                <RealStepVisual tutorialId={tutorial.id} stepN={s.n} videoTs={s.video_ts} />
              ) : (
                <StepVisual videoTs={s.video_ts} diagramType={tutorial.diagram_type} />
              )}
              <span className="step-text">
                <b>{s.title}</b>
                <span className="desc">{s.description}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
