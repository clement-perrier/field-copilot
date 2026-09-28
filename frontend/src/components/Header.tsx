interface HeaderProps {
  tutorialCount: number;
  onNewConversation: () => void;
}

export function Header({ tutorialCount, onNewConversation }: HeaderProps) {
  return (
    <header>
      <div className="brand">
        <div className="brand-mark" />
        <div className="brand-text">
          <h1>Field Copilot</h1>
          <p>Conversational assistant — expert knowledge captured through video sessions</p>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="status-pill">
          <span className="dot" />
          Knowledge base loaded — {tutorialCount} intervention{tutorialCount > 1 ? "s" : ""} indexed
        </div>
        {/* Utile en démo pour repartir d'un fil propre entre deux scénarios,
            sans faire défiler un historique qui s'allonge. */}
        <button type="button" className="chip-btn" onClick={onNewConversation}>
          New conversation
        </button>
      </div>
    </header>
  );
}
