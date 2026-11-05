import { useEffect, useState, type ReactNode } from "react";
import DotGrid from "../../rb/DotGrid";
import SplitFlapText from "../../rb/SplitFlapText";
import StarBorder from "../../rb/StarBorder";
import { go } from "../../router";
import { PxIcon } from "../PxIcon";
import "./shift.css";

/**
 * The $SHIFT and DeFi pages' few shared pieces (token, stake, swap, tokenomics, deals, impact, frogs, forge, watch):
 * the desktop-only decoration switch, the hero's dot field, the one primary action and the split-flap board.
 * The page kit (../kit) stays the source of heroes, stats and panels; this only tunes React Bits for these pages.
 */

/** Heavy effects are decoration: wide screens only, never with reduced motion or in lite mode. */
export function useRich(): boolean {
  const [rich, setRich] = useState(false);
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setRich(wide.matches && !still.matches && !document.documentElement.hasAttribute("data-lite"));
    sync();
    wide.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => { wide.removeEventListener("change", sync); still.removeEventListener("change", sync); };
  }, []);
  return rich;
}

const DOTS = { lime: ["#132816", "#b8ff3d"], imd: ["#14305e", "#2f7bff"], gold: ["#2e2610", "#f2c14e"] } as const;

/** The dot field behind a hero (one WebGL canvas, desktop only). Pass it as PxHero's `bg`. */
export function HeroDots({ tone = "lime" }: { tone?: keyof typeof DOTS }) {
  const rich = useRich();
  if (!rich) return null;
  const [base, active] = DOTS[tone];
  return <DotGrid dotSize={3} gap={20} baseColor={base} activeColor={active} proximity={130} shockRadius={200} shockStrength={4} shape="square" glow={0.3} clickShock={false} dpr={1.5} />;
}

const STAR = { color: "#b8ff3d", duration: 5, thickness: 1, radius: 2, backgroundColor: "#b8ff3d", textColor: "#031007", borderColor: "rgba(184,255,61,.6)" } as const;

/**
 * The page's single primary action, a star running its border. A route (`to`), a link (`href`, `#anchor` or
 * external) or a button (`onClick`, `disabled`): the same element the page had, only dressed.
 */
export function ShStar({ to, href, external, onClick, disabled, icon, children, className, wide }: {
  to?: string; href?: string; external?: boolean; onClick?: () => void; disabled?: boolean; icon?: string; children: ReactNode; className?: string; wide?: boolean;
}) {
  const cls = `sh-star${wide ? " wide" : ""}${className ? ` ${className}` : ""}`;
  const inner = <>{icon && <PxIcon name={icon} size={14} />}<span>{children}</span></>;
  if (to) return <StarBorder as="a" href={to} className={cls} {...STAR} onClick={(e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>{inner}</StarBorder>;
  if (href) return <StarBorder as="a" href={href} className={cls} {...STAR} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inner}</StarBorder>;
  return <StarBorder as="button" type="button" className={cls} {...STAR} onClick={onClick} disabled={disabled}>{inner}</StarBorder>;
}

/** A split-flap readout (prices, counts, clocks). The label is read out once; the tiles are decoration. */
export function Flap({ text, size = 24, pad, charset = "0123456789$.,:-%×/ KMB", tone = "lime" }: { text: string; size?: number; pad?: number; charset?: string; tone?: "lime" | "gold" | "imd" | "dim" }) {
  const ink = { lime: "#b8ff3d", gold: "#f2c14e", imd: "#8db6ff", dim: "#93a89a" }[tone];
  return <SplitFlapText className="sh-flap" text={text} charset={charset} tileColor="#0d1410" textColor={ink} fontSize={size} gap={3} tileRadius={2} flipDuration={0.07} stagger={0.025} flipsPerChar={5} padTo={pad ?? text.length} intro={false} loop={false} tileStyle="minimal" />;
}

/** A small terminal readout line: `root@nightshift:~$ <cmd>` with a blinking block cursor. */
export function Prompt({ cmd }: { cmd: string }) {
  return <div className="sh-prompt" aria-hidden="true"><span>root@nightshift:~$</span><span>{cmd}</span><i /></div>;
}
