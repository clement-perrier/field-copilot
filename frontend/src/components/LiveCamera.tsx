import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

// Impose une limite de bord raisonnable pour la frame capturée — même logique
// que MAX_IMAGE_EDGE dans ChatPanel.tsx pour les photos jointes à la main :
// Claude redimensionne de toute façon au-delà, et une frame plus légère part
// plus vite sur un réseau mobile pendant la démo.
const MAX_CAPTURE_EDGE = 1280;

export interface LiveCameraHandle {
  // Capture la frame courante en JPEG, sans rien changer à l'affichage vidéo
  // (le flux continue de tourner à l'écran) — voir LIVE_MODE_DECISIONS.md :
  // "pas geler la vidéo de l'utilisateur, mais en arrière-plan on s'active
  // avec la frame récupérée". Retourne null si la caméra n'est pas prête.
  captureFrame: () => { dataUrl: string; mediaType: string; base64: string } | null;
}

interface LiveCameraProps {
  onError: (message: string) => void;
}

export const LiveCamera = forwardRef<LiveCameraHandle, LiveCameraProps>(function LiveCamera({ onError }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // facingMode: "environment" demande la caméra arrière en priorité — sur
    // téléphone, c'est celle qui filme l'équipement, pas le technicien
    // lui-même. "ideal" plutôt que "exact" : certains appareils (laptop sans
    // caméra arrière) n'en ont qu'une, autant l'utiliser plutôt qu'échouer.
    //
    // width/height ideal ajoutés le 27/08/2026 : sans contrainte de résolution,
    // le navigateur retombe sur une résolution par défaut très basse (640x480
    // constaté en conditions réelles, voir LIVE_MODE_DECISIONS.md) — largement
    // insuffisant pour que le matching ORB trouve assez de points caractéristiques
    // à comparer à la photo de référence. "ideal" (pas "exact") pour ne pas
    // échouer sur un appareil qui ne peut pas monter aussi haut.
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      })
      .catch((err) => {
        onError(`Camera access failed (${String(err instanceof Error ? err.message : err)}).`);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onError est stable en pratique (voir ChatPanel), pas besoin de relancer la caméra s'il change de référence
  }, []);

  useImperativeHandle(ref, () => ({
    captureFrame() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !ready || video.videoWidth === 0) return null;

      const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.split(",")[1];
      return { dataUrl, mediaType: "image/jpeg", base64 };
    },
  }));

  return (
    <div className="live-camera">
      {/* muted + playsInline nécessaires pour que Safari iOS lise le flux en
          ligne sans passer en plein écran ni exiger d'interaction utilisateur
          supplémentaire (une caméra n'a de toute façon pas de son à couper). */}
      <video ref={videoRef} autoPlay muted playsInline />
      <canvas ref={canvasRef} hidden />
      <div className="live-camera-badge">● LIVE</div>
    </div>
  );
});
