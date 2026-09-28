import { useRef, useState } from "react";
import { CLIP_DURATION } from "./StepVisual";
import { Lightbox } from "./Lightbox";

// Pendant de StepVisual.tsx, mais pour le seul tutoriel qui s'appuie sur une
// vraie vidéo (CH1, voir CLAUDE.md, note du 25/08/2026) : la frame fixe est
// une vraie image extraite de la vidéo (backend/scripts/extract_frames.py),
// et le clic joue la vraie vidéo à partir du timestamp de l'étape, au lieu du
// <canvas> qui simule un aperçu. Légende volontairement différente de
// StepVisual ("vraie captation") pour ne jamais laisser croire à une session
// filmée pour de vrai — voir CLAUDE.md.

function videoTsToSeconds(videoTs: string): number {
  const [minutes, seconds] = videoTs.split(":").map(Number);
  return minutes * 60 + seconds;
}

export function RealStepVisual({ tutorialId, stepN, videoTs }: { tutorialId: string; stepN: number; videoTs: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  const annotatedUrl = `/media/${tutorialId}/step-${stepN}-annotated.jpg`;
  const plainUrl = `/media/${tutorialId}/step-${stepN}.jpg`;
  const [imgSrc, setImgSrc] = useState(annotatedUrl);

  const startSeconds = videoTsToSeconds(videoTs);

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const elapsed = video.currentTime - startSeconds;
    setProgressPct(Math.min(100, (elapsed / CLIP_DURATION) * 100));
    if (elapsed >= CLIP_DURATION) {
      video.pause();
      setPlaying(false);
    }
  }

  // Le <video> est démonté/remonté à chaque bascule (playing ? <video> : <img>),
  // donc son readyState repart à zéro : currentTime ne peut être fixé qu'une
  // fois les métadonnées chargées (onLoadedMetadata), pas juste après le clic
  // — le fixer trop tôt est silencieusement ignoré par le navigateur.
  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = startSeconds;
    video.play();
  }

  function togglePlay() {
    if (playing) {
      videoRef.current?.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
  }

  function openLightbox(e: React.MouseEvent) {
    e.stopPropagation(); // ne pas aussi déclencher togglePlay() de la frame parente
    setEnlarged(true);
    setPlaying(true);
  }

  function closeLightbox() {
    videoRef.current?.pause();
    setEnlarged(false);
    setPlaying(false);
  }

  // Le <video> ne s'affiche qu'à un seul endroit à la fois : en ligne (petite
  // vignette) tant qu'on n'a pas agrandi, dans la lightbox une fois agrandi —
  // jamais les deux, un seul <video>/ref à gérer.
  const videoEl = (
    <video
      ref={videoRef}
      src={`/media/${tutorialId}/source.mp4`}
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
      onError={() => setPlaying(false)}
      muted
      playsInline
    />
  );
  // Bascule sur la frame brute (non annotée) si l'annotée n'existe pas pour
  // cette étape — une seule étape en a une, voir extract_frames.py.
  const imgEl = <img src={imgSrc} alt={`Step ${stepN}, ${videoTs}`} onError={() => setImgSrc(plainUrl)} />;

  return (
    <div className="step-visual">
      <div className="step-visual-frame" onClick={togglePlay}>
        {playing && !enlarged ? videoEl : imgEl}
        {!playing && <span className="play-overlay">▶</span>}
        <button type="button" className="expand-btn" onClick={openLightbox} title="Enlarge">
          ⤢
        </button>
      </div>
      {playing && !enlarged && (
        <div className="progress">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}
      <div className="step-visual-caption">{videoTs} · real footage, reused for demo</div>
      {enlarged && (
        <Lightbox onClose={closeLightbox}>
          {playing ? videoEl : imgEl}
          {playing && (
            <div className="lightbox-progress">
              <div className="lightbox-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}
          <div className="lightbox-caption">{videoTs} · real footage, reused for demo</div>
        </Lightbox>
      )}
    </div>
  );
}
