import type { CSSProperties, ReactNode } from "react";
import { SiteShell } from "./SiteShell";
import { PreviewLink } from "./PreviewLink";
import { SECTIONS, itemPath, sectionPath, type SiteItem, type SiteSection } from "./sitemap";
import "./site.css";
import "./legacy.css";

const pattern = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[a-z]+/gi, "[^/]+")}(?:/.*)?$`);
/** The section and page a route belongs to: the longest matching page path, its aliases included. */
export function placeOf(path: string): { section: SiteSection; item?: SiteItem } | null {
  let best: { section: SiteSection; item: SiteItem; length: number } | null = null;
  for (const section of SECTIONS) for (const item of section.items) {
    for (const candidate of [item.path, ...(item.aliases ?? [])]) {
      if (candidate.startsWith("/new") || candidate === "/") continue;
      if (pattern(candidate).test(path) && (!best || candidate.length > best.length)) best = { section, item, length: candidate.length };
    }
  }
  return best;
}

/**
 * The older pages inside the new station shell: the same header, search, section tabs and footer, a
 * trail of the section's pages, and the legacy theme that moves their styles onto the new tokens.
 * Their own room classes stay on the wrapper so their layout rules still apply.
 */
export function LegacyShell({ path, clarity, children }: { path: string; clarity: boolean; children: ReactNode }) {
  const place = placeOf(path), section = place?.section;
  const pages = section?.items.filter((item) => !item.path.includes(":") && !item.path.startsWith("/new") && item.path !== "/") ?? [];
  const here = place?.item ? itemPath(place.item) : undefined;
  return <SiteShell active={section?.id}>
    <div className="ns ns-app nx-shell pv-legacy" style={{ "--acc": section?.accent ?? "#ad9bd2", "--acc2": section?.accent ?? "#ad9bd2" } as CSSProperties}>
      {section && <nav className="pv-trail" aria-label={`${section.name} pages`}>
        <PreviewLink className="pv-trail-home" href={sectionPath(section)}>{section.name}</PreviewLink>
        <div>{pages.map((item) => <a key={item.path} href={itemPath(item)} aria-current={itemPath(item) === here ? "page" : undefined}>{item.title}</a>)}</div>
      </nav>}
      <main id="pv-main" className={clarity ? "clarity-main" : undefined}>{children}</main>
    </div>
  </SiteShell>;
}
