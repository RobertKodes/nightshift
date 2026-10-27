import { useEffect, useState } from "react";
import { Link } from "../router";
import { UtilityLinks } from "../HowThisConnects";
import { NxIcon } from "./icons";
import { WAYS, type RoomId } from "./map";
import { Footer, NxTabs, StationBar } from "./Shell";
import { StationMap } from "./StationMap";
import "./nx.css";

/** Start with a task. The station art stays the same. */
export function Gate() {
  const [focus, setFocus] = useState<RoomId | null>(null);
  useEffect(() => { document.title = "NIGHTSHIFT · AI tools, Play, $SHIFT"; }, []);
  return <div className="ns nx-gate clarity-home">
    <StationMap focus={focus} />
    <header className="nx-head"><StationBar room={null} /><UtilityLinks /></header>
    <section className="nx-gate-in">
      <span className="nx-eyebrow">NIGHTSHIFT · BUILT WITH IMD</span>
      <h1 className="nx-title">What brings you<br />to the night shift?</h1>
      <p className="nx-gate-lead">IMD is the network of AI agents behind our tools and commissioned work. Pick what you want to do.</p>
      <div className="clarity-doors">{WAYS.map((way) => <a key={way.key} href={way.to} className="clarity-door" style={{ "--acc": way.accent } as React.CSSProperties} onPointerEnter={() => setFocus(way.room)} onPointerLeave={() => setFocus(null)} onFocus={() => setFocus(way.room)} onBlur={() => setFocus(null)}>
        <img src={way.emblem} alt="" width={76} height={76} /><div><h2>{way.title}</h2><p>{way.line}</p></div><NxIcon name="arrow" size={20} />
      </a>)}</div>
      <div className="clarity-start"><Link to="/services/verdict">Try a free token preview →</Link><Link to="/how-it-works">How it works →</Link><Link to="/mcp">Connect an AI agent →</Link></div>
    </section>
    <Footer room={null} /><NxTabs room={null} />
  </div>;
}
