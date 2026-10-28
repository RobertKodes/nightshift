import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CONNECTIONS, CONNECTION_ROUTES, type FlightInput } from "../station3d/stops";
import { useStationReadings } from "../station3d/readings";
import { PreviewLink } from "./PreviewLink";
import { SECTIONS, sectionPath, type SectionId } from "./sitemap";
import { SectionIcon } from "./SectionIcon";
import { StationView, type StationHandle, useReducedMotion } from "./StationView";

/** Native document scroll drives one reversible flight; buttons and docks use the same stops. */
export function StationHome({ onActive }: { onActive: (id?: SectionId) => void }) {
  const reduced = useReducedMotion(), readings = useStationReadings();
  const [active, setActive] = useState(0), [paused, setPaused] = useState(false);
  const journey = useRef<HTMLDivElement>(null), chapters = useRef<(HTMLElement | null)[]>([]);
  const card = useRef<HTMLDivElement>(null), intro = useRef<HTMLDivElement>(null), view = useRef<StationHandle>(null);
  const input = useRef<FlightInput>({ progress: 1, pointerX: 0, pointerY: 0, panelTop: .6, flowVisibility: [] });
  const jump = useCallback((index: number) => {
    const section = chapters.current[index];
    if (section) window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top, behavior: reduced ? "instant" : "smooth" });
  }, [reduced]);
  useEffect(() => {
    input.current.still = paused; view.current?.invalidate();
  }, [paused]);
  useEffect(() => {
    let frame = 0, landscape = innerWidth > innerHeight;
    const update = () => {
      frame = 0;
      const first = chapters.current[0], next = chapters.current[1];
      if (!first || !next) return;
      const start = first.getBoundingClientRect().top, span = next.offsetTop - first.offsetTop;
      const p = Math.max(0, Math.min(SECTIONS.length, -start / Math.max(1, span)));
      const current = Math.min(SECTIONS.length, Math.round(p));
      input.current.progress = reduced ? current + 1 : p + 1;
      const stage = journey.current?.querySelector(".pv-stage")?.getBoundingClientRect();
      const stageTop = stage?.top ?? 0, stageHeight = stage?.height ?? innerHeight;
      input.current.panelTop = ((card.current?.getBoundingClientRect().top ?? innerHeight * .62) - stageTop) / stageHeight;
      input.current.heroBottom = ((current === 0 ? intro.current?.getBoundingClientRect().bottom ?? 100 : document.querySelector(".pv-header")?.getBoundingClientRect().bottom ?? 64) - stageTop) / stageHeight;
      input.current.flowVisibility = CONNECTIONS.map((_, index) => {
        const line = document.getElementById(`pv-flow-${index}`)?.getBoundingClientRect();
        return line ? Math.max(0, Math.min(line.bottom, innerHeight - 80) - Math.max(line.top, 80)) / Math.max(1, line.height) : 0;
      });
      setActive(current); onActive(SECTIONS[current]?.id); view.current?.invalidate();
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = () => {
      const nextLandscape = innerWidth > innerHeight;
      if (landscape !== nextLandscape) {
        const chapter = chapters.current[Math.max(0, Math.min(SECTIONS.length, Math.round(input.current.progress) - 1))];
        if (chapter) window.scrollTo({ top: scrollY + chapter.getBoundingClientRect().top, behavior: "instant" });
      }
      landscape = nextLandscape; request();
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || reduced) return;
      input.current.pointerX = event.clientX / innerWidth * 2 - 1; input.current.pointerY = event.clientY / innerHeight * 2 - 1;
    };
    const reset = () => { input.current.pointerX = 0; input.current.pointerY = 0; };
    const surface = journey.current, observer = new ResizeObserver(request);
    if (card.current) observer.observe(card.current);
    if (intro.current) observer.observe(intro.current);
    const bar = document.querySelector(".pv-bar"); if (bar) observer.observe(bar);
    addEventListener("scroll", request, { passive: true }); addEventListener("resize", resize); surface?.addEventListener("pointermove", pointer); surface?.addEventListener("pointerleave", reset);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); removeEventListener("scroll", request); removeEventListener("resize", resize); surface?.removeEventListener("pointermove", pointer); surface?.removeEventListener("pointerleave", reset); };
  }, [reduced, onActive]);
  const section = SECTIONS[Math.min(active, SECTIONS.length - 1)]!;
  const metric = active === 1 ? readings.agents : active === 2 ? readings.tables : active === 3 ? readings.staked : active === 4 ? readings.frogs : null;
  const connections = active === SECTIONS.length;
  return <main id="pv-main" className="pv-home" data-step={active}>
    <div className="pv-journey" ref={journey}>
      <div className="pv-stage">
        <StationView ref={view} input={input.current} active={active} overview={connections} onDock={jump} reduced={reduced} />
        <div ref={intro} className="pv-intro"><h1>Start an AI company.</h1><p>AI companies, useful tools, and free games.</p></div>
        <button className="pv-motion pv-icon-button" type="button" hidden={reduced} aria-label={paused ? "Resume motion" : "Pause motion"} aria-pressed={paused} title={paused ? "Resume motion" : "Pause motion"} onClick={() => setPaused((value) => !value)}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">{paused ? <path d="m6 4 10 6-10 6Z" fill="currentColor" /> : <path d="M6 5v10M13 5v10" stroke="currentColor" strokeWidth="2" />}</svg></button>
        <div ref={card} className="pv-tour-ui" style={{ "--accent": section.accent } as CSSProperties}>
          <nav className="pv-chips" aria-label="Choose a station stop">{SECTIONS.map((item, index) => <button key={item.id} type="button" onClick={() => jump(index)} aria-current={active === index ? "step" : undefined} style={{ "--accent": item.accent } as CSSProperties}>{item.short}</button>)}</nav>
          {!connections ? <div className="pv-stop-card" key={section.id}>
            <div className="pv-stop-heading"><SectionIcon id={section.id} /><h2>{section.name}</h2>{metric?.state === "ready" && <span className="pv-metric">{metric.value} <small>{metric.label}</small></span>}</div>
            <p>{section.line}</p>
            <div className="pv-actions">{section.actions.map((action, index) => <a className={index === 0 ? "pv-button pv-primary" : "pv-button"} key={action.path} href={action.path}>{action.title}<SectionIcon id="arrow" /></a>)}</div>
            <PreviewLink className="pv-everything" href={sectionPath(section)}>Everything in {section.name}<SectionIcon id="arrow" /></PreviewLink>
          </div> : <div className="pv-stop-card pv-connect-card">
            <h2>How it connects</h2>
            <ol>{CONNECTIONS.map((line, index) => <li id={`pv-flow-${index}`} key={line} style={{ "--accent": SECTIONS.find((item) => item.id === CONNECTION_ROUTES[index]!.from)!.accent } as CSSProperties}>{line}</li>)}</ol>
            <a className="pv-everything" href="/how-it-works">How it works in detail<SectionIcon id="arrow" /></a>
          </div>}
          <div className="pv-tour-controls"><button type="button" className="pv-button" disabled={active === 0} onClick={() => jump(active - 1)}>Back</button><div className="pv-position" aria-live="polite"><span>{connections ? "Connected" : `${active + 1} of ${SECTIONS.length}`}</span><div aria-hidden="true">{SECTIONS.map((item, index) => <i key={item.id} data-active={active === index} />)}</div></div><button type="button" className="pv-button" onClick={() => jump(connections ? 0 : active + 1)}>{connections ? "Back to start" : active === SECTIONS.length - 1 ? "How it connects" : "Next"}<SectionIcon id="arrow" /></button></div>
        </div>
      </div>
      <div className="pv-chapters" aria-label="Station tour">{[...SECTIONS.map((item) => item.name), "How it connects"].map((name, index) => <section key={name} className="pv-chapter" ref={(element) => { chapters.current[index] = element; }} aria-label={name}><span className="pv-sr">{name}</span></section>)}</div>
    </div>
  </main>;
}
