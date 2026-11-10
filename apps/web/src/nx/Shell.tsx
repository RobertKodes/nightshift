// the station kit (nx-btn, drawers, desk cards): loaded first, so the protocol styles below win
import "./nx.css";
import ClickSpark from "../rb/ClickSpark";
import { SxFooter, SxHeader, SxSectionBar, SxTabs } from "../saas/chrome";
import { SKIN_ACCENT, groupOf, skinOf } from "../saas/nav";
import "../saas/protocol.css";
import "../saas/protocol-type.css";

/** Kept for pages that draw their own phone bar (the full-screen games). */
export function NxTabs(_: { room?: string | null }) {
  return <SxTabs />;
}

/** A page of the site: the header, the tabs of its menu group, the page, the full footer. */
export function PageShell({ path, lean = false, title, children }: { path: string; lean?: boolean; title?: string; children: React.ReactNode }) {
  const skin = skinOf(path);
  const [acc, acc2] = SKIN_ACCENT[skin];
  return (
    <ClickSpark sparkColor={["#b8ff3d", "#57d97b"]} sparkSize={6} sparkRadius={16} sparkCount={7} shape="line" duration={380}>
    <div className="px ns ns-app nx-shell" data-room={skin} style={{ "--acc": acc, "--acc2": acc2 } as React.CSSProperties}>
      <SxHeader path={path} title={title} />
      {!lean && <SxSectionBar group={groupOf(path)} path={path} />}
      <main className={["/services", "/games", "/token", "/how-it-works"].includes(path) ? "clarity-main" : undefined}>{children}</main>
      <SxFooter />
      <SxTabs path={path} />
    </div>
    </ClickSpark>
  );
}
