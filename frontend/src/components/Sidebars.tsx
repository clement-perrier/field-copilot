import type { Gap, Tutorial } from "../types";

interface SidebarLeftProps {
  equipmentList: string[];
  selectedEquipment: string | null;
  onSelectEquipment: (equipment: string | null) => void;
  tutorials: Tutorial[];
}

export function SidebarLeft({ equipmentList, selectedEquipment, onSelectEquipment, tutorials }: SidebarLeftProps) {
  return (
    <aside className="sidebar panel">
      <p className="panel-title">Equipment context</p>
      <div>
        <button
          type="button"
          className={`eq-chip${selectedEquipment === null ? " active" : ""}`}
          onClick={() => onSelectEquipment(null)}
        >
          All equipment
        </button>
        {equipmentList.map((eq) => (
          <button
            key={eq}
            type="button"
            className={`eq-chip${selectedEquipment === eq ? " active" : ""}`}
            onClick={() => onSelectEquipment(eq)}
          >
            {eq}
          </button>
        ))}
      </div>

      <p className="panel-title" style={{ marginTop: 18 }}>
        Knowledge base
      </p>
      <div>
        {tutorials.map((t) => (
          <div className="kb-item" key={t.id}>
            <span className="kb-id">
              {t.id} · {t.equipment}
            </span>
            <span className="kb-title">{t.title}</span>
            <span className="kb-expert">{t.expert.name}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface SidebarRightProps {
  gaps: Gap[];
  stats: { q: number; a: number; g: number };
}

export function SidebarRight({ gaps, stats }: SidebarRightProps) {
  return (
    <aside className="sidebar-right panel">
      <p className="panel-title">
        Gaps detected <span className="count">{gaps.length}</span>
      </p>
      {gaps.length === 0 ? (
        <p className="empty-note">
          No gaps detected yet. Questions outside the knowledge base will appear here.
        </p>
      ) : (
        <div>
          {gaps.map((g, i) => (
            <div className="gap-item" key={i}>
              <span className="gap-q">{g.topic}</span>
              <span className="gap-t">{new Date(g.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      )}

      <p className="panel-title" style={{ marginTop: 18 }}>
        Session
      </p>
      <div className="stat-row">
        <span>Questions asked</span>
        <b>{stats.q}</b>
      </div>
      <div className="stat-row">
        <span>Grounded answers</span>
        <b>{stats.a}</b>
      </div>
      <div className="stat-row">
        <span>Gaps</span>
        <b>{stats.g}</b>
      </div>
    </aside>
  );
}
