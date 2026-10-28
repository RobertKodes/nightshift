import type { CSSProperties } from "react";
import { PreviewLink } from "./PreviewLink";
import { SectionIcon } from "./SectionIcon";
import { SECTIONS, sectionPath, type SectionId } from "./sitemap";
import "./site.css";

/** The station's six section tabs for full-screen pages: the new site's phone bar, phones only. */
export function StationTabs({ active }: { active?: SectionId }) {
  return <div className="pv pv-tabs-only"><nav className="pv-bar" aria-label="Station sections">{SECTIONS.map((section) => <PreviewLink key={section.id} href={sectionPath(section)} style={{ "--accent": section.accent } as CSSProperties} aria-current={active === section.id ? "page" : undefined}><SectionIcon id={section.id} /><span>{section.short}</span></PreviewLink>)}</nav></div>;
}
