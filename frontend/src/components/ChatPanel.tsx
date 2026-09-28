import { useEffect, useRef, useState } from "react";
import { checkEquipment, checkStepTransition, streamChat } from "../api";
import type { ChatMessageData, Tutorial } from "../types";
import { ChatMessage } from "./ChatMessage";
import { LiveCamera, type LiveCameraHandle } from "./LiveCamera";

// Intervalle de sondage en mode live (voir routers/live.py). Remonté de 1500 à
// 3000ms le 28/08/2026 après un test réel montrant le bouton "Next step"
// apparaître prématurément à répétition : le temps de réponse CLIP (~1.3-1.4s)
// fixe un plancher technique, mais le vrai facteur limitant s'est révélé être
// la fiabilité, pas la latence — plusieurs `visual_state` n'ont qu'une marge
// de quelques centièmes au-dessus du seuil de déclenchement (voir
// LIVE_MODE_DECISIONS.md), et doubler la fréquence de sondage double aussi le
// nombre d'occasions pour un bruit de frame (flou, éclairage) de franchir ce
// seuil par accident. Redescendu à 2500ms le 27/08/2026 : `pollBusyRef` (voir
// plus bas) saute déjà tout tick dont le précédent n'est pas revenu, donc une
// valeur mesurément proche du plancher technique (~1.3-1.4s) sans y coller
// pile reste sûre — voir LIVE_MODE_DECISIONS.md pour la marge conservée sur
// chaque seuil individuel, pas retouchée ici.
const LIVE_POLL_INTERVAL_MS = 2500;

type LivePhase = "equipment" | "problem" | "steps";

interface AttachedImage {
  dataUrl: string; // pour l'aperçu et l'affichage dans la bulle du message
  mediaType: string;
  base64: string; // sans le préfixe "data:...;base64," — c'est ça qui part vers l'API
}

// Icône caméra vidéo en SVG plutôt que l'emoji 🎥 : un emoji garde toujours
// ses couleurs natives (impossible à recolorer en CSS), alors qu'un tracé
// stroke="currentColor" hérite de la couleur du bouton — nécessaire pour la
// teinte bleu clair demandée le 27/08/2026, cohérente avec --cyan déjà utilisé
// partout ailleurs dans le design.
function VideoCameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

// data:image/jpeg;base64,XXXX -> {mediaType: "image/jpeg", base64: "XXXX"}
function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const [header, base64] = dataUrl.split(",");
  const mediaType = header.slice("data:".length, header.indexOf(";"));
  return { mediaType, base64 };
}

// 1568px : la taille de bord max au-delà de laquelle Claude redimensionne de
// toute façon côté API — inutile d'envoyer plus gros.
const MAX_IMAGE_EDGE = 1568;

// Reencode systématiquement en JPEG via un <canvas>, quel que soit le format
// d'origine. Nécessaire pour les photos de téléphone : un iPhone envoie du
// HEIC par défaut (accept="image/*" du input ne garantit rien sur le format
// réel du fichier), un format que l'API du modèle rejette avec un 400 — testé
// en conditions réelles, pas une hypothèse. Le <canvas> ne connaît que des
// pixels décodés, donc l'export est toujours un JPEG standard, quel que soit
// ce que le navigateur a réussi à décoder en entrée.
function reencodeAsJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context unavailable."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image format not recognized by the browser."));
    };
    img.src = objectUrl;
  });
}

interface ChatPanelProps {
  conversationId: string;
  selectedEquipment: string | null;
  tutorialsById: Record<string, Tutorial>;
  onQuestionAsked: () => void;
  onAnswerGrounded: () => void;
  onGapLogged: () => void;
  // Remonté jusqu'à App.tsx (plutôt qu'un useState local) : activer le mode
  // live doit aussi masquer l'en-tête et les panneaux latéraux pour passer en
  // plein écran (demande explicite du 27/08/2026) — une décision que
  // ChatPanel seul ne peut pas prendre, il ne connaît pas ses parents.
  liveMode: boolean;
  onLiveModeChange: (v: boolean) => void;
}

export function ChatPanel({
  conversationId,
  selectedEquipment,
  tutorialsById,
  onQuestionAsked,
  onAnswerGrounded,
  onGapLogged,
  liveMode,
  onLiveModeChange,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageData[]>([
    {
      role: "assistant",
      text:
        "Hi, I'm Field Copilot. Describe the issue you're facing in the field " +
        "(equipment, symptom, error code) and I'll guide you based on already " +
        "documented interventions. You can also click a suggested question below.",
      pending: false,
      gap: false,
      citations: [],
      toolActivity: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  // Machine à états de l'entonnoir du mode live (voir LIVE_MODE_DECISIONS.md,
  // "entonnoir étape par étape") : équipement → problème → étapes. Pilotée par
  // le sondage périodique ci-dessous, pas par des messages tapés à la main.
  const [livePhase, setLivePhase] = useState<LivePhase>("equipment");
  // Nom de l'équipement reconnu par le sondage (phase "equipment") — envoyé
  // comme equipment_context sur les tours de conversation suivants, exactement
  // comme la sélection manuelle du panneau latéral (voir claude_agent.py :
  // même mécanisme de note de contexte). Remplace, depuis le 28/08/2026, la
  // frame envoyée à chaque message : la reconnaissance ne se fait plus qu'une
  // fois, ici, pas re-tentée à chaque tour.
  const [recognizedEquipment, setRecognizedEquipment] = useState<string | null>(null);
  const [lockedTutorialId, setLockedTutorialId] = useState<string | null>(null);
  const [currentStepN, setCurrentStepN] = useState<number | null>(null);
  // true dès que le sondage détecte que l'étape courante est terminée — fait
  // apparaître le bouton "Next step" (voir rendu plus bas) et arrête le
  // sondage pour cette étape (pas la peine de re-sonder avant que
  // l'utilisateur avance réellement).
  const [stepReadyToAdvance, setStepReadyToAdvance] = useState(false);
  // Ligne de statut discrète affichée sous la caméra pendant le mode live —
  // pas un message du fil de discussion (voir pushSyntheticAssistantMessage,
  // réservé aux vraies transitions) : juste un retour visuel que le sondage
  // tourne bien, mis à jour EN PLACE à chaque tick plutôt qu'empilé, pour ne
  // pas polluer le chat avec un message par frame envoyée (une toutes les
  // LIVE_POLL_INTERVAL_MS ms).
  const [pollStatus, setPollStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveCameraRef = useRef<LiveCameraHandle>(null);
  // Un ref, pas un state : doit être lu/écrit de façon synchrone DANS le tick
  // du sondage (voir plus bas) pour empêcher que plusieurs appels
  // /api/live/equipment-check se chevauchent en vol (setInterval déclenche un
  // nouveau tick toutes les 3s sans attendre que le précédent ait répondu —
  // sur une connexion lente, ex: tunnel Cloudflare, plusieurs tics peuvent
  // partir avant que le premier revienne). Un state avec son cycle de rendu
  // asynchrone ne suffirait pas à garantir cette exclusion.
  const pollBusyRef = useRef(false);
  // Idem : garantit qu'on n'annonce la reconnaissance qu'UNE SEULE fois même
  // si plusieurs appels se chevauchent malgré pollBusyRef (ex: un appel lancé
  // juste avant que ce ref soit remis à false pour la session live suivante).
  // Bug réel observé le 28/08/2026 : jusqu'à 5 messages "I recognize the
  // equipment..." dupliqués en conditions réelles, faute de cette garde.
  const equipmentAnnouncedRef = useRef(false);

  // Message purement frontend (pas un vrai tour de conversation Claude) pour
  // annoncer une transition détectée par le sondage — garde l'"impression de
  // temps réel" sans payer un appel API réel à chaque détection.
  function pushSyntheticAssistantMessage(text: string) {
    setMessages((prev) => [...prev, { role: "assistant", text, pending: false, gap: false, citations: [], toolActivity: [] }]);
  }

  // Vrai une fois sur la DERNIÈRE étape du tutoriel verrouillé — il y a
  // toujours un bouton à cette étape (sinon le technicien n'a aucun moyen de
  // signaler la fin d'un tutoriel qui se termine sur une étape manuelle,
  // comme IC1 aujourd'hui), mais son libellé devient "Finish" plutôt que
  // "Next step" puisqu'il n'y a plus d'étape suivante vers laquelle avancer.
  // `tutorialsById` vient de GET /api/knowledge-base (voir App.tsx), seule
  // source qui connaît le nombre total d'étapes.
  const lockedTutorial = lockedTutorialId ? tutorialsById[lockedTutorialId] : undefined;
  const isLastStep = lockedTutorial !== undefined && currentStepN !== null && currentStepN >= lockedTutorial.steps.length;

  // Étape courante marquée `auto_detect: false` dans data/knowledge_base.json
  // (couvercle ouvert/fermé, anneau remis en place — voir LIVE_MODE_DECISIONS.md :
  // même bruit non détectable pour un état localisé sur une petite pièce d'un
  // objet qui reste, par ailleurs, identique, testé sous 5 mécanismes différents).
  // `?? true` : une étape sans le champ (tutoriels hors mode live, jamais lus ici
  // de toute façon) reste fiable par défaut, cohérent avec 001_schema.sql.
  const currentStep = lockedTutorial?.steps.find((s) => s.n === currentStepN);
  const currentStepAutoDetect = currentStep?.auto_detect ?? true;

  // Pas de détection fiable pour ces étapes : le bouton "Next step" est
  // disponible dès l'arrivée dessus plutôt que d'attendre un sondage qui ne
  // se déclenchera jamais avec confiance — confirmation du technicien, pas
  // une détection déguisée en détection.
  useEffect(() => {
    if (livePhase === "steps" && currentStepN !== null && !currentStepAutoDetect) {
      setStepReadyToAdvance(true);
      setPollStatus("✋ Detection unreliable for this step — confirm manually when done");
    }
  }, [livePhase, currentStepN, currentStepAutoDetect]);

  // Sondage périodique — voir routers/live.py : ces deux endpoints ne passent
  // jamais par Claude, juste une comparaison CLIP déterministe. Un vrai tour
  // de conversation (sendMessage) n'est déclenché qu'au clic sur "Next step"
  // ou quand l'utilisateur tape lui-même un message.
  useEffect(() => {
    if (!liveMode || sending) return;
    if (livePhase === "problem") return; // phase purement conversationnelle, rien à regarder
    if (
      livePhase === "steps" &&
      (stepReadyToAdvance || lockedTutorialId === null || currentStepN === null || !currentStepAutoDetect)
    )
      return;

    const interval = setInterval(async () => {
      // Empêche deux tics de se chevaucher (voir déclaration de pollBusyRef) —
      // si le précédent appel n'a pas encore répondu, on saute ce tick plutôt
      // que d'en empiler un deuxième.
      if (pollBusyRef.current) return;
      const frame = liveCameraRef.current?.captureFrame();
      if (!frame) return;
      const image = { media_type: frame.mediaType, data: frame.base64 };
      pollBusyRef.current = true;
      setPollStatus("📡 Frame sent — analyzing…");

      try {
        if (livePhase === "equipment") {
          const { candidates } = await checkEquipment(image);
          // Un seul candidat net (voir equipment_identifier.py, logique de
          // marge) : équipement confirmé, on passe à la phase suivante.
          // Plusieurs ou aucun : on continue de sonder, rien à faire ici —
          // le technicien peut aussi taper un message pour lever l'ambiguïté
          // lui-même à tout moment.
          if (candidates.length === 1) {
            setPollStatus(`✓ Object recognized: ${candidates[0].equipment}`);
            if (!equipmentAnnouncedRef.current) {
              equipmentAnnouncedRef.current = true;
              setRecognizedEquipment(candidates[0].equipment);
              pushSyntheticAssistantMessage(
                `I recognize the equipment: ${candidates[0].equipment}. What's the problem you're facing?`,
              );
              setLivePhase("problem");
            }
          } else if (candidates.length > 1) {
            setPollStatus("🔍 Several possible matches — keep filming or describe the equipment");
          } else {
            setPollStatus("🔍 No clear match yet…");
          }
        } else if (livePhase === "steps" && lockedTutorialId && currentStepN !== null) {
          const { transitioned } = await checkStepTransition(image, lockedTutorialId, currentStepN);
          setPollStatus(transitioned ? "✓ Step finished recognized" : "🔍 Step in progress…");
          if (transitioned) setStepReadyToAdvance(true);
        }
      } catch {
        // Sondage best-effort : une erreur réseau ponctuelle ne doit pas
        // interrompre la conversation, on retente simplement au prochain tick.
        setPollStatus("⚠ Frame analysis failed — retrying next tick");
      } finally {
        pollBusyRef.current = false;
      }
    }, LIVE_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [liveMode, livePhase, lockedTutorialId, currentStepN, stepReadyToAdvance, sending, currentStepAutoDetect]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // repermet de sélectionner à nouveau le même fichier plus tard
    if (!file) return;
    setAttachError(null);
    try {
      const dataUrl = await reencodeAsJpeg(file);
      const { mediaType, base64 } = parseDataUrl(dataUrl);
      setAttachedImage({ dataUrl, mediaType, base64 });
    } catch (err) {
      setAttachError(`Couldn't use this photo (${String(err instanceof Error ? err.message : err)}).`);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Applique une mise à jour au DERNIER message de la liste (celui en cours de
  // streaming) — les événements SSE arrivent tous pour ce tour-là tant qu'on
  // n'a pas reçu `final`.
  function updateLastAssistant(updater: (m: Extract<ChatMessageData, { role: "assistant" }>) => Extract<ChatMessageData, { role: "assistant" }>) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role === "assistant") next[next.length - 1] = updater(last);
      return next;
    });
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // Le mode live n'attache plus de frame aux messages depuis le 28/08/2026 —
    // la reconnaissance d'équipement et la détection de fin d'étape tournent
    // entièrement via le sondage périodique ci-dessus, plus besoin d'envoyer
    // d'image à chaque tour de conversation (voir LIVE_MODE_DECISIONS.md).
    const image = liveMode ? null : attachedImage;

    setMessages((prev) => [...prev, { role: "user", text: trimmed, imageDataUrl: image?.dataUrl }]);
    setMessages((prev) => [...prev, { role: "assistant", text: "", pending: true, gap: false, citations: [], toolActivity: [] }]);
    setInput("");
    setAttachedImage(null);
    setSending(true);
    onQuestionAsked();

    try {
      await streamChat(
        {
          message: trimmed,
          // En mode live, l'équipement reconnu par le sondage (voir plus haut)
          // prime sur le filtre du panneau latéral — c'est ce que le
          // technicien est réellement en train de filmer, la sélection
          // manuelle n'a pas de sens une fois le mode live actif.
          equipment_context: (liveMode ? recognizedEquipment : selectedEquipment) ?? undefined,
          conversation_id: conversationId,
          image: image ? { media_type: image.mediaType, data: image.base64 } : undefined,
          // Dit au backend quel system prompt appliquer (réponse complète vs
          // guidage étape par étape) — voir types.ts, ChatRequest.live.
          live: liveMode,
        },
        {
          onToolCall: (e) =>
            updateLastAssistant((m) => ({
              ...m,
              toolActivity: [...m.toolActivity, { tool: e.tool, status: "calling", input: e.input }],
            })),
          onToolResult: (e) =>
            updateLastAssistant((m) => ({
              ...m,
              // Le backend n'appelle jamais deux fois le même tool "en même
              // temps" (voir claude_agent.py : tool_call/tool_result sont émis
              // par paire avant de passer au suivant) — matcher par nom sur
              // l'entrée "calling" la plus récente est donc sans ambiguïté.
              toolActivity: m.toolActivity.map((t) =>
                t.tool === e.tool && t.status === "calling"
                  ? { ...t, status: "done", resultCount: e.result_count, stepsFound: e.steps_found }
                  : t,
              ),
            })),
          onAnswerDelta: (e) => updateLastAssistant((m) => ({ ...m, text: m.text + e.text })),
          onFinal: (e) => {
            updateLastAssistant((m) => ({
              ...m,
              text: e.answer,
              gap: e.gap,
              citations: e.citations,
              partMatch: e.part_match,
              pending: false,
            }));
            if (e.gap) onGapLogged();
            else onAnswerGrounded();

            // Fait avancer l'entonnoir (voir plus haut) : dès qu'une étape est
            // citée en mode live — que ce soit la première fois (phase
            // "problem" → "steps") ou une fois qu'on y est déjà (après un clic
            // sur "Next step") — c'est cette citation qui fait foi pour savoir
            // où on en est, pas un suivi manuel séparé.
            if (liveMode && e.citations.length > 0) {
              const citation = e.citations[0];
              setLockedTutorialId(citation.tutorial_id);
              setCurrentStepN(Math.max(...citation.steps));
              setLivePhase("steps");
              setStepReadyToAdvance(false);
            }
          },
          onError: (e) =>
            updateLastAssistant((m) => ({ ...m, text: `Connection to the service failed (${e.message}).`, pending: false })),
        },
      );
    } catch (err) {
      updateLastAssistant((m) => ({ ...m, text: `Connection to the service failed (${String(err)}).`, pending: false }));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`chat-panel${liveMode ? " live-fullscreen-panel" : ""}`}>
      {/* Mode live : caméra tout en haut (plein écran, voir App.tsx), chat
          scrollable en dessous, pas de pièce jointe manuelle en parallèle —
          les frames de ce flux ne sont utilisées que par le sondage
          périodique ci-dessus, jamais attachées à un message envoyé. */}
      {liveMode && <LiveCamera ref={liveCameraRef} onError={setLiveError} />}
      {liveMode && pollStatus && <div className="live-poll-status">{pollStatus}</div>}
      {liveError && <div className="attach-error">{liveError}</div>}
      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} tutorialsById={tutorialsById} />
        ))}
      </div>

      {/* N'apparaît qu'en phase "steps", une fois le sondage périodique (ou
          l'arrivée sur une étape manuelle, voir useEffect plus haut) ayant
          rendu l'étape courante prête à avancer — demande explicite du
          27/08/2026, pas affiché en permanence pendant qu'une étape est
          encore en cours. Reste affiché sur la dernière étape (corrigé le
          28/08/2026 : un tutoriel qui se termine sur une étape manuelle,
          comme IC1 aujourd'hui, n'a sinon aucun moyen de signaler sa fin) —
          seul le libellé change, "Finish" plutôt que "Next step". */}
      {liveMode && livePhase === "steps" && stepReadyToAdvance && (
        <div className="next-step-row">
          <button
            type="button"
            // Distingue visuellement une détection automatique (cyan, comme
            // le reste du mode live) d'une confirmation manuelle (ambre,
            // même code couleur que le panneau de lacunes — "à surveiller",
            // pas "confirmé par le système") : ne pas laisser croire que ces
            // étapes-là ont été détectées alors que ça vient du technicien.
            className={`next-step-btn${currentStepAutoDetect ? "" : " manual"}`}
            onClick={() => {
              // Retiré tout de suite, pas seulement quand la réponse de Claude
              // arrive (onFinal le remet à false aussi, mais après un aller-
              // retour réseau) — demande explicite du 28/08/2026 : le bouton ne
              // doit pas rester affiché pendant qu'on attend la réponse.
              setStepReadyToAdvance(false);
              // Message différent sur la dernière étape : "next step please"
              // sur un tutoriel qui n'a pas d'étape suivante risquerait de
              // pousser Claude à en inventer une plutôt qu'à conclure.
              sendMessage(isLastStep ? "Done, that completes the procedure." : "Done, next step please.");
            }}
          >
            {isLastStep
              ? currentStepAutoDetect
                ? "✓ Step complete — Finish"
                : "Finish (confirm manually)"
              : currentStepAutoDetect
                ? "✓ Step complete — Next step"
                : "Next step (confirm manually)"}
          </button>
        </div>
      )}
      {!liveMode && attachedImage && (
        <div className="attached-image-preview">
          <img src={attachedImage.dataUrl} alt="Photo to attach" />
          <button type="button" onClick={() => setAttachedImage(null)} aria-label="Remove photo">
            ✕
          </button>
        </div>
      )}
      {attachError && <div className="attach-error">{attachError}</div>}
      <div className="chat-input-row">
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileSelected} />
        {/* Joindre une photo à la main ne fonctionne qu'avec le tutoriel CH1
            (chiller CH-12, voir claude_agent.py, règle de grounding #5) —
            masqué en mode live, qui n'attache plus de photo aux messages. */}
        {!liveMode && (
          <button
            type="button"
            className="attach-btn"
            title="Attach a photo (CH-12 chiller only)"
            onClick={() => fileInputRef.current?.click()}
          >
            📎
          </button>
        )}
        <button
          type="button"
          className={`attach-btn live-toggle-btn${liveMode ? " active" : ""}`}
          title="Live camera mode"
          onClick={() => {
            setLiveError(null);
            setAttachedImage(null);
            const turningOn = !liveMode;
            onLiveModeChange(turningOn);
            // Réinitialise l'entonnoir à l'activation — une nouvelle session
            // live repart de l'identification d'équipement, jamais de l'état
            // laissé par la précédente. Fait ici plutôt que dans un effet
            // séparé sur `liveMode` : c'est l'événement qui déclenche le
            // changement, pas besoin de resynchroniser après coup.
            if (turningOn) {
              setLivePhase("equipment");
              setRecognizedEquipment(null);
              equipmentAnnouncedRef.current = false;
              pollBusyRef.current = false;
              setLockedTutorialId(null);
              setCurrentStepN(null);
              setStepReadyToAdvance(false);
              setPollStatus(null);
              // Confirme l'activation dans le fil de discussion — demande
              // explicite du 28/08/2026 : sans ça, rien n'indique que le mode
              // live écoute déjà avant la toute première reconnaissance.
              pushSyntheticAssistantMessage(
                "Live mode is on. Point the camera at the equipment you're having trouble with — I'll identify it automatically, then we'll go from there.",
              );
            }
          }}
        >
          <VideoCameraIcon />
        </button>
        <input
          type="text"
          placeholder={liveMode ? "Describe what you're filming…" : "Describe the issue you're facing in the field…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
        />
        <button type="button" disabled={sending} onClick={() => sendMessage(input)}>
          Send
        </button>
      </div>
    </section>
  );
}
