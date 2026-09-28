import { useEffect, useMemo, useState } from "react";
import { fetchGaps, fetchKnowledgeBase } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { Header } from "./components/Header";
import { SidebarLeft, SidebarRight } from "./components/Sidebars";
import type { Gap, Tutorial } from "./types";

// Un seul par session de navigateur, généré une fois au montage — le backend
// s'en sert de clé pour retrouver l'historique de la conversation en mémoire
// (voir routers/chat.py, _conversations). Pas de persistance nécessaire au
// rechargement de la page pour ce prototype.
function makeConversationId(): string {
  return crypto.randomUUID();
}

function App() {
  const [conversationId, setConversationId] = useState(makeConversationId);
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [stats, setStats] = useState({ q: 0, a: 0, g: 0 });
  // Remonté depuis ChatPanel (pas un useState local là-bas) : activer le mode
  // live doit aussi masquer l'en-tête et les panneaux latéraux pour passer en
  // plein écran (demande explicite du 27/08/2026) — une décision qui se prend
  // ici, pas dans ChatPanel qui ne connaît pas ses parents.
  const [liveMode, setLiveMode] = useState(false);

  // "Nouvelle conversation" : un nouvel id suffit côté backend (un id jamais vu
  // démarre un historique vide, voir routers/chat.py). Le `key={conversationId}`
  // sur <ChatPanel> force React à le démonter/remonter, ce qui réinitialise son
  // état interne (messages) sans avoir à faire remonter cette logique ici.
  function handleNewConversation() {
    setConversationId(makeConversationId());
    setStats({ q: 0, a: 0, g: 0 });
  }

  useEffect(() => {
    fetchKnowledgeBase().then(setTutorials).catch(console.error);
    fetchGaps().then(setGaps).catch(console.error);
  }, []);

  const equipmentList = useMemo(() => [...new Set(tutorials.map((t) => t.equipment))], [tutorials]);
  const tutorialsById = useMemo(() => Object.fromEntries(tutorials.map((t) => [t.id, t])), [tutorials]);

  return (
    <div className="app">
      {!liveMode && <Header tutorialCount={tutorials.length} onNewConversation={handleNewConversation} />}

      <div className={liveMode ? "live-fullscreen" : "layout"}>
        {!liveMode && (
          <SidebarLeft
            equipmentList={equipmentList}
            selectedEquipment={selectedEquipment}
            onSelectEquipment={setSelectedEquipment}
            tutorials={tutorials}
          />
        )}

        <ChatPanel
          key={conversationId}
          conversationId={conversationId}
          selectedEquipment={selectedEquipment}
          tutorialsById={tutorialsById}
          onQuestionAsked={() => setStats((s) => ({ ...s, q: s.q + 1 }))}
          onAnswerGrounded={() => setStats((s) => ({ ...s, a: s.a + 1 }))}
          onGapLogged={() => {
            setStats((s) => ({ ...s, g: s.g + 1 }));
            fetchGaps().then(setGaps).catch(console.error);
          }}
          liveMode={liveMode}
          onLiveModeChange={setLiveMode}
        />

        {!liveMode && <SidebarRight gaps={gaps} stats={stats} />}
      </div>

      {!liveMode && (
        <footer>PROTOTYPE — fictional data and interventions for demonstration purposes · real calls to the Claude model</footer>
      )}
    </div>
  );
}

export default App;
