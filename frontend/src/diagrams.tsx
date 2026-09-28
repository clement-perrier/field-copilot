// Schémas techniques, un par équipement retenu pour la démo (voir CLAUDE.md,
// note du 24/08/2026 : équipements remplacés, diagrammes redessinés en
// conséquence). Même grammaire graphique que la référence : trait cyan, 4
// repères numérotés en pastille ambre, légende associée — voir DESIGN_SYSTEM.md.
// Portés en JSX plutôt qu'en chaîne HTML injectée (innerHTML) comme dans la
// référence — c'est la façon React idiomatique de faire la même chose.

interface DiagramPart {
  n: number;
  label: string;
}

interface DiagramDef {
  parts: DiagramPart[];
  Svg: () => React.ReactElement;
}

function Pin({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="9" fill="var(--amber)" stroke="none" />
      <text x={x} y={y + 4} fontSize="10" fill="#06202c" textAnchor="middle" fontFamily="IBM Plex Mono">
        {n}
      </text>
    </>
  );
}

function EvseSvg() {
  return (
    <svg viewBox="0 0 240 200" stroke="var(--cyan)" fill="none" strokeWidth="1.6">
      <rect x="75" y="15" width="70" height="155" rx="6" />
      <rect x="90" y="30" width="40" height="24" rx="2" />
      <circle cx="110" cy="80" r="14" />
      <rect x="95" y="105" width="30" height="18" rx="2" />
      <path d="M110 123 q 45 15 45 42" />
      <rect x="145" y="163" width="24" height="15" rx="2" />
      <rect x="65" y="150" width="90" height="18" rx="2" strokeDasharray="4 3" />
      <Pin x={110} y={42} n={1} />
      <Pin x={157} y={170} n={2} />
      <Pin x={110} y={80} n={3} />
      <Pin x={110} y={159} n={4} />
    </svg>
  );
}

function BoilerSvg() {
  return (
    <svg viewBox="0 0 240 200" stroke="var(--cyan)" fill="none" strokeWidth="1.6">
      <rect x="55" y="20" width="130" height="150" rx="6" />
      <rect x="75" y="35" width="90" height="30" rx="2" />
      <rect x="75" y="78" width="90" height="52" rx="2" strokeDasharray="4 3" />
      <circle cx="120" cy="104" r="16" />
      <rect x="95" y="140" width="20" height="18" rx="2" />
      <line x1="105" y1="158" x2="105" y2="170" />
      <rect x="150" y="140" width="18" height="14" rx="1" />
      <Pin x={120} y={50} n={1} />
      <Pin x={120} y={82} n={2} />
      <Pin x={105} y={149} n={3} />
      <Pin x={159} y={147} n={4} />
    </svg>
  );
}

function EscooterSvg() {
  return (
    <svg viewBox="0 0 240 200" stroke="var(--cyan)" fill="none" strokeWidth="1.6">
      <rect x="40" y="128" width="120" height="14" rx="4" />
      <rect x="55" y="142" width="60" height="18" rx="2" strokeDasharray="4 3" />
      <circle cx="45" cy="166" r="16" />
      <line x1="45" y1="150" x2="70" y2="55" />
      <rect x="60" y="40" width="34" height="16" rx="2" />
      <circle cx="165" cy="166" r="16" />
      <rect x="150" y="138" width="30" height="20" rx="2" />
      <Pin x={85} y={151} n={1} />
      <Pin x={165} y={148} n={2} />
      <Pin x={165} y={166} n={3} />
      <Pin x={77} y={48} n={4} />
    </svg>
  );
}

function ChillerSvg() {
  return (
    <svg viewBox="0 0 240 200" stroke="var(--cyan)" fill="none" strokeWidth="1.6">
      <rect x="35" y="30" width="60" height="140" rx="6" />
      <circle cx="65" cy="48" r="10" />
      <rect x="50" y="150" width="30" height="14" rx="2" />
      <rect x="105" y="55" width="100" height="95" rx="6" />
      <circle cx="165" cy="102" r="28" />
      <line x1="165" y1="102" x2="150" y2="88" />
      <line x1="165" y1="102" x2="180" y2="88" />
      <line x1="165" y1="102" x2="150" y2="116" />
      <line x1="165" y1="102" x2="180" y2="116" />
      <Pin x={65} y={100} n={1} />
      <Pin x={65} y={48} n={2} />
      <Pin x={65} y={157} n={3} />
      <Pin x={165} y={102} n={4} />
    </svg>
  );
}

export const DIAGRAM_DEFS: Record<string, DiagramDef> = {
  evse: {
    Svg: EvseSvg,
    parts: [
      { n: 1, label: "Control screen" },
      { n: 2, label: "Type 2 cable and connector" },
      { n: 3, label: "RFID badge reader" },
      { n: 4, label: "Breaker / residual current device (RCD) at the base" },
    ],
  },
  boiler: {
    Svg: BoilerSvg,
    parts: [
      { n: 1, label: "Display and control buttons" },
      { n: 2, label: "Burner and electrode access hatch" },
      { n: 3, label: "Condensate drain trap" },
      { n: 4, label: "Gas inlet valve" },
    ],
  },
  escooter: {
    Svg: EscooterSvg,
    parts: [
      { n: 1, label: "Removable battery compartment" },
      { n: 2, label: "Control housing and IoT module" },
      { n: 3, label: "Rear wheel brake / locking servo motor" },
      { n: 4, label: "Handlebar and onboard display" },
    ],
  },
  chiller: {
    Svg: ChillerSvg,
    parts: [
      { n: 1, label: "Cooling fluid reservoir" },
      { n: 2, label: "Quick fluid coupling" },
      { n: 3, label: "Power connector" },
      { n: 4, label: "Fan and control probe" },
    ],
  },
};

export function Diagram({ type }: { type: string }) {
  const def = DIAGRAM_DEFS[type];
  if (!def) return null;
  const { Svg, parts } = def;
  return (
    <>
      <div className="diagram-box">
        <Svg />
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.n}>
            <b>{p.n}</b>
            {p.label}
          </li>
        ))}
      </ul>
    </>
  );
}
