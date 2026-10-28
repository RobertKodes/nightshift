import { useEffect, useState } from "react";
import { useRoute } from "../router";
import { SiteShell } from "./SiteShell";
import { StationHome } from "./StationHome";
import { SectionHub } from "./SectionHub";
import { PreviewLink } from "./PreviewLink";
import { findSection, type SectionId } from "./sitemap";
import "./site.css";

/** Hidden routes share one shell and never replace an existing page. */
export function PreviewSite() {
  const path = useRoute(), parts = path.split("/").filter(Boolean), section = findSection(parts[1] ?? "");
  const [tourSection, setTourSection] = useState<SectionId | undefined>("companies");
  useEffect(() => { document.title = `${section?.name ?? "NIGHTSHIFT"} · Preview`; }, [section]);
  useEffect(() => {
    if (parts.length > 1) document.querySelector<HTMLElement>(".pv-hub h1")?.focus({ preventScroll: true });
  }, [path]);
  return <SiteShell active={section?.id ?? (parts.length === 1 ? tourSection : undefined)}>
    {parts.length === 1 ? <StationHome onActive={setTourSection} /> : section && parts.length === 2 ? <SectionHub key={section.id} section={section} /> : <main id="pv-main" className="pv-missing"><h1>Section not found</h1><PreviewLink className="pv-button" href="/new">Back to the station</PreviewLink></main>}
  </SiteShell>;
}
