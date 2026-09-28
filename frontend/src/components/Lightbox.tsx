import { useEffect } from "react";

// Boîte modale générique pour agrandir un visuel d'étape (StepVisual ou
// RealStepVisual) — les deux l'utilisent de la même façon plutôt que chacun
// sa propre logique de fermeture/overlay.
export function Lightbox({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="lightbox-panel bracket" onClick={(e) => e.stopPropagation()}>
        <div className="bl" />
        <div className="br" />
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
