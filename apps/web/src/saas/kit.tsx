import type { CSSProperties, ReactNode } from "react";
import CountUp from "../rb/CountUp";
import DecryptedText from "../rb/DecryptedText";
import { Link } from "../router";
import { PxIcon } from "./PxIcon";
import "./kit.css";

/**
 * The protocol page kit: the few blocks every page is built from, so forty pages read as one product.
 * A hero (kicker, title with a decrypting accent, lead, actions), live numbers that count up, terminal
 * panels with corner ticks, section heads, and pixel tags. See DESIGN.md.
 */

/** The top of a page. `accent` is the part of the title in lime that decrypts in. */
export function PxHero({ kicker, title, accent, lead, actions, aside, live, bg }: {
  kicker: string; title: ReactNode; accent?: string; lead?: ReactNode; actions?: ReactNode; aside?: ReactNode;
  /** a LIVE tag on the kicker line, for pages that read the chain or the engine */
  live?: boolean;
  /** a React Bits background behind the hero (keep it light: DotGrid, PixelSnow, LetterGlitch at low opacity) */
  bg?: ReactNode;
}) {
  return (
    <section className={`pk-hero${aside ? " has-aside" : ""}`}>
      {bg && <div className="pk-hero-bg" aria-hidden="true">{bg}</div>}
      <div className="pk-hero-copy">
        <div className="pk-kicker-row">
          <span className="px-kicker">{kicker}</span>
          {live && <span className="pk-live"><i />LIVE</span>}
        </div>
        <h1 className="pk-h1">
          {title}{accent && <>{" "}<em><DecryptedText text={accent} animateOn="view" sequential revealDirection="start" speed={34} characters="█▓▒░<>/\\|01" /></em></>}
        </h1>
        {lead && <p className="pk-lead">{lead}</p>}
        {actions && <div className="px-cta-row pk-actions">{actions}</div>}
      </div>
      {aside && <div className="pk-hero-aside">{aside}</div>}
    </section>
  );
}

/** A number that counts up when it scrolls into view; a dash while it loads. */
export function PxNum({ value, decimals = 0, prefix = "", suffix = "", compact = false }: { value: number | null | undefined; decimals?: number; prefix?: string; suffix?: string; compact?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <>—</>;
  return <CountUp to={value} decimals={decimals} prefix={prefix} suffix={suffix} duration={1.3} separator="," format={compact ? "compact" : "standard"} trigger="view" />;
}

/** A stat tile: Silkscreen label, mono number, a small line under it. */
export function PxStat({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "lime" | "gold" | "imd" | "red"; to?: string }) {
  const body = (<><span className="pk-stat-k">{label}</span><b className={`pk-stat-v ${tone ?? ""}`}>{value}</b>{sub && <small className="pk-stat-s">{sub}</small>}</>);
  return to ? <Link to={to} className="pk-stat">{body}</Link> : <div className="pk-stat">{body}</div>;
}

/** A row of stat tiles. */
export function PxStats({ children, cols }: { children: ReactNode; cols?: number }) {
  return <div className="pk-stats" style={cols ? ({ "--cols": cols } as CSSProperties) : undefined}>{children}</div>;
}

/** A terminal block: a header strip with a Silkscreen title and an optional state, then the body. */
export function PxPanel({ title, state, right, children, tone, className }: { title?: ReactNode; state?: "live" | "idle" | "warn"; right?: ReactNode; children: ReactNode; tone?: "imd" | "gold"; className?: string }) {
  return (
    <section className={`pk-panel${tone ? ` ${tone}` : ""}${className ? ` ${className}` : ""}`}>
      {(title || state || right) && (
        <header className="pk-panel-h">
          <span className="pk-dots" aria-hidden="true"><i /><i /><i /></span>
          {title && <b>{title}</b>}
          {state && <span className={`pk-state ${state}`}><i />{state.toUpperCase()}</span>}
          {right && <span className="pk-panel-r">{right}</span>}
        </header>
      )}
      <div className="pk-panel-b">{children}</div>
    </section>
  );
}

/** A section: kicker, title, a line under it, a link on the right. */
export function PxSection({ kicker, title, sub, more, children, id }: { kicker: string; title: ReactNode; sub?: ReactNode; more?: { to: string; label: string }; children: ReactNode; id?: string }) {
  return (
    <section className="px-sec pk-sec" aria-labelledby={id}>
      <div className="px-sec-head">
        <div>
          <span className="px-kicker">{kicker}</span>
          <h2 className="px-h2" id={id}>{title}</h2>
          {sub && <p className="px-sub">{sub}</p>}
        </div>
        {more && <Link to={more.to} className="px-more">{more.label} →</Link>}
      </div>
      {children}
    </section>
  );
}

/** A pixel tag. */
export function PxTag({ children, tone }: { children: ReactNode; tone?: "lime" | "gold" | "imd" | "red" | "dim" }) {
  return <span className={`pk-tag ${tone ?? ""}`}>{children}</span>;
}

/** A protocol button (a Link when `to` is set). */
export function PxButton({ to, href, onClick, children, kind, icon, disabled, type }: { to?: string; href?: string; onClick?: () => void; children: ReactNode; kind?: "primary" | "ghost" | "gold" | "imd" | "danger"; icon?: string; disabled?: boolean; type?: "button" | "submit" }) {
  const cls = `px-btn${kind ? ` ${kind}` : ""}`;
  const inner = <>{icon && <PxIcon name={icon} size={14} />}{children}</>;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} className={cls} target="_blank" rel="noreferrer">{inner}</a>;
  return <button type={type ?? "button"} className={cls} onClick={onClick} disabled={disabled}>{inner}</button>;
}
