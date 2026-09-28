import { useEffect, useRef, useState } from "react";
import { Lightbox } from "./Lightbox";

// Le visuel associé à une étape citée : une image fixe (le "frame clé" que la
// vraie pipeline SightCall extrairait de la vidéo de session), toujours
// visible — et un clic dessus joue le segment vidéo propre à cette étape
// (déjà découpé de la session complète, donc court et autonome, pas un point
// à chercher dans une longue vidéo partagée).
//
// Toujours pas une vraie vidéo (CLAUDE.md : interventions fictives, aucune
// vraie captation n'existe) — le <canvas> façon viseur AR reste un mock
// assumé et étiqueté comme tel. Ce qui change ici : la frame dessine la
// silhouette de l'équipement concerné (mêmes coordonnées que diagrams.tsx,
// réexprimées en tracés canvas plutôt qu'en SVG) au lieu d'une grille
// abstraite identique pour les 3 équipements — sans les repères numérotés,
// qui désignent les 4 parties fixes de l'équipement, pas les étapes.

// Exporté : RealStepVisual.tsx (vraie vidéo, tutoriel CH1) réutilise la même
// durée de clip pour un comportement cohérent entre les deux composants.
export const CLIP_DURATION = 8; // secondes, choix arbitraire pour le mock

// Les coordonnées ci-dessous sont volontairement les mêmes que dans
// diagrams.tsx (repère 240x200) : une silhouette cohérente avec le grand
// schéma affiché à côté dans la carte de citation, pas un second dessin
// indépendant à maintenir en double dans l'esprit.
function drawEquipment(ctx: CanvasRenderingContext2D, w: number, h: number, diagramType: string) {
  const sx = w / 240;
  const sy = h / 200;

  const rect = (x: number, y: number, rw: number, rh: number, dashed = false) => {
    ctx.save();
    if (dashed) ctx.setLineDash([3, 2]);
    ctx.strokeRect(x * sx, y * sy, rw * sx, rh * sy);
    ctx.restore();
  };
  const circle = (cx: number, cy: number, radius: number) => {
    ctx.beginPath();
    ctx.arc(cx * sx, cy * sy, radius * Math.min(sx, sy), 0, Math.PI * 2);
    ctx.stroke();
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1 * sx, y1 * sy);
    ctx.lineTo(x2 * sx, y2 * sy);
    ctx.stroke();
  };

  ctx.strokeStyle = "#56c7e8";
  ctx.lineWidth = 1.2;

  if (diagramType === "evse") {
    rect(75, 15, 70, 155);
    rect(90, 30, 40, 24);
    circle(110, 80, 14);
    rect(95, 105, 30, 18);
    ctx.beginPath();
    ctx.moveTo(110 * sx, 123 * sy);
    ctx.quadraticCurveTo(155 * sx, 138 * sy, 155 * sx, 165 * sy);
    ctx.stroke();
    rect(145, 163, 24, 15);
    rect(65, 150, 90, 18, true);
  } else if (diagramType === "boiler") {
    rect(55, 20, 130, 150);
    rect(75, 35, 90, 30);
    rect(75, 78, 90, 52, true);
    circle(120, 104, 16);
    rect(95, 140, 20, 18);
    line(105, 158, 105, 170);
    rect(150, 140, 18, 14);
  } else if (diagramType === "escooter") {
    rect(40, 128, 120, 14);
    rect(55, 142, 60, 18, true);
    circle(45, 166, 16);
    line(45, 150, 70, 55);
    rect(60, 40, 34, 16);
    circle(165, 166, 16);
    rect(150, 138, 30, 20);
  }
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number, playing: boolean, diagramType: string) {
  ctx.fillStyle = "#0c1c2b";
  ctx.fillRect(0, 0, w, h);

  drawEquipment(ctx, w, h, diagramType);

  // Cadre viseur AR par-dessus la silhouette — l'indicateur "c'est un aperçu
  // caméra", indépendant du dessin de l'équipement lui-même.
  ctx.strokeStyle = "#56c7e8";
  ctx.lineWidth = 2;
  const m = 6;
  const c = 9;
  [
    [m, m, c, 0, 0, c],
    [w - m, m, -c, 0, 0, c],
    [m, h - m, c, 0, 0, -c],
    [w - m, h - m, -c, 0, 0, -c],
  ].forEach(([x, y, dx1, dy1, dx2, dy2]) => {
    ctx.beginPath();
    ctx.moveTo(x + dx1, y + dy1);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx2, y + dy2);
    ctx.stroke();
  });

  if (playing) {
    const sweepY = (elapsed * 30) % h;
    ctx.strokeStyle = "rgba(86, 199, 232, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, sweepY);
    ctx.lineTo(w, sweepY);
    ctx.stroke();
  }

  const pulse = playing ? 3 + Math.sin(elapsed * 5) * 1.5 : 3;
  ctx.fillStyle = "#f5a623";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, pulse, 0, Math.PI * 2);
  ctx.fill();
}

export function StepVisual({ videoTs, diagramType }: { videoTs: string; diagramType: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const largeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [elapsedInClip, setElapsedInClip] = useState(0);

  // Dessine sur les deux canvas à la fois (la vignette, et la version agrandie
  // dans la lightbox si elle est ouverte) — un seul .current à null suffit à
  // ignorer celui qui n'est pas monté, pas besoin de deux jeux d'effects.
  function drawBoth(elapsed: number, playingNow: boolean) {
    for (const canvas of [canvasRef.current, largeCanvasRef.current]) {
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) draw(ctx, canvas.width, canvas.height, elapsed, playingNow, diagramType);
    }
  }

  // Frame fixe : un seul rendu, pas de boucle d'animation tant qu'on ne joue pas.
  useEffect(() => {
    if (playing) return;
    drawBoth(0, false);
  }, [playing, diagramType, enlarged]);

  // Lecture du clip : boucle d'animation + minuteur, s'arrête tout seul après
  // CLIP_DURATION secondes et revient à la frame fixe.
  useEffect(() => {
    if (!playing) return;

    let raf = 0;
    let start: number | null = null;

    function tick(t: number) {
      if (start === null) start = t;
      const elapsed = (t - start) / 1000;
      if (elapsed >= CLIP_DURATION) {
        setPlaying(false);
        setElapsedInClip(0);
        return;
      }
      setElapsedInClip(elapsed);
      drawBoth(elapsed, true);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, diagramType]);

  const progressPct = (elapsedInClip / CLIP_DURATION) * 100;

  function openLightbox(e: React.MouseEvent) {
    e.stopPropagation(); // ne pas aussi déclencher le toggle play de la frame parente
    setEnlarged(true);
    setPlaying(true);
  }

  function closeLightbox() {
    setEnlarged(false);
    setPlaying(false);
    setElapsedInClip(0);
  }

  return (
    <div className="step-visual">
      <div className="step-visual-frame" onClick={() => setPlaying((p) => !p)}>
        <canvas ref={canvasRef} width={112} height={72} />
        {!playing && <span className="play-overlay">▶</span>}
        <button type="button" className="expand-btn" onClick={openLightbox} title="Enlarge">
          ⤢
        </button>
      </div>
      {playing && (
        <div className="progress">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}
      <div className="step-visual-caption">{videoTs} · illustrative preview</div>
      {enlarged && (
        <Lightbox onClose={closeLightbox}>
          <canvas ref={largeCanvasRef} width={480} height={309} />
          {playing && (
            <div className="lightbox-progress">
              <div className="lightbox-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}
          <div className="lightbox-caption">{videoTs} · illustrative preview</div>
        </Lightbox>
      )}
    </div>
  );
}
