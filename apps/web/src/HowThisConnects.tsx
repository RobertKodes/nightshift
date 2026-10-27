import { Link } from "./router";

const DOORS = [
  { id: "services", to: "/services", label: "AI tools", line: "Check tokens, test APIs, research or hire the IMD swarm." },
  { id: "games", to: "/games", label: "Play", line: "Start pinball, chess, pool or poker without a wallet." },
  { id: "token", to: "/token", label: "$SHIFT", line: "See holder benefits, swap, stake and check rewards." },
];

/** The other doors, in plain words. */
export function HowThisConnects({ current }: { current: "services" | "games" | "token" }) {
  return <aside className="clarity-box connections" aria-label="How this connects">
    <h2>How this connects</h2>
    <div className="clarity-grid">{DOORS.filter((door) => door.id !== current).map((door) => <Link key={door.id} to={door.to}><b>{door.label} →</b><span>{door.line}</span></Link>)}
      <Link to="/how-it-works"><b>How it works →</b><span>Follow the payments, fees and funded rewards.</span></Link>
    </div>
  </aside>;
}

export function UtilityLinks() {
  return <nav className="clarity-utilities" aria-label="Help and connections"><Link to="/mcp">Connect</Link><Link to="/proof">Proof</Link><Link to="/security">Security</Link><Link to="/how-it-works">How it works</Link></nav>;
}
