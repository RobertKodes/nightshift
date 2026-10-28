import { lazy, Suspense, useEffect, useState } from "react";
import { useRoute } from "../router";
import { SiteShell } from "./SiteShell";
import { StationHome } from "./StationHome";
import { SectionHub } from "./SectionHub";
import { PreviewLink } from "./PreviewLink";
import { findSection, type SectionId } from "./sitemap";
import "./site.css";

const ShipDeck = lazy(() => import("../ship3d/ShipDeckPage").then((module) => ({ default: module.ShipDeckPage })));
const Welcome = lazy(() => import("./Welcome").then((module) => ({ default: module.Welcome })));

/** Hidden routes share one shell and never replace an existing page. */
export function PreviewSite() {
  const path = useRoute(), parts = path.split("/").filter(Boolean), section = findSection(parts[1] ?? "");
  const ship = parts.length === 2 && parts[1] === "ship", welcome = parts.length === 2 && parts[1] === "welcome";
  const [tourSection, setTourSection] = useState<SectionId | undefined>("companies");
  useEffect(() => { if (!welcome) document.title = `${section?.name ?? (ship ? "Operations deck" : "NIGHTSHIFT")} · Preview`; }, [section, ship, welcome]);
  useEffect(() => {
    if (parts.length > 1) document.querySelector<HTMLElement>(".pv-hub h1")?.focus({ preventScroll: true });
  }, [path]);
  // the landing stands alone: no header, no tabs, one way in
  if (welcome) return <Suspense fallback={<main className="pv" />}><Welcome /></Suspense>;
  return <SiteShell active={section?.id ?? (ship ? "frogs" : parts.length === 1 ? tourSection : undefined)}>
    {parts.length === 1 ? <StationHome onActive={setTourSection} /> : ship ? <Suspense fallback={<main id="pv-main" className="pv-hub"><h1>Operations deck</h1><p>Loading the live deck...</p></main>}><ShipDeck /></Suspense> : section && parts.length === 2 ? <SectionHub key={section.id} section={section} /> : <main id="pv-main" className="pv-missing"><h1>Section not found</h1><PreviewLink className="pv-button" href="/new">Back to the station</PreviewLink></main>}
  </SiteShell>;
}
