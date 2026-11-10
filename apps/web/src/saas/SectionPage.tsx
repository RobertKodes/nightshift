import { Link } from "../router";
import { SECTIONS, isFile } from "../site/sitemap";
import { PxHero, PxNum, PxStat, PxStats } from "./kit";
import { FOUND } from "./nav";
import { PxIcon } from "./PxIcon";
import { LxBg, LxStar, useRich } from "./pages/learn-kit";
import "./saas.css";
import "./pages/learn.css";

/** The simple sitemap: every page in the menus, grouped the way the menu groups them. */
export function SxIndex() {
  const rich = useRich();
  const pages = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="lx lx-index">
      <PxHero
        kicker="INDEX"
        title="Every"
        accent="page."
        bg={<LxBg rich={rich} />}
        lead="The whole site on one page, grouped the way the menu groups it."
        actions={<>
          <LxStar to={FOUND} icon="blocks">FOUND A COMPANY</LxStar>
          <Link to="/start" className="px-btn"><PxIcon name="doc" size={14} />START HERE</Link>
          <Link to="/" className="px-btn ghost">BACK TO THE FRONT</Link>
        </>}
        aside={
          <PxStats cols={2}>
            <PxStat label="Pages" value={<PxNum value={pages} />} sub="in this index" tone="lime" />
            <PxStat label="Sections" value={<PxNum value={SECTIONS.length} />} sub="the same as the menu" />
          </PxStats>
        }
      />
      <div className="lx-dir">
        {SECTIONS.map((section) => (
          <div className="lx-dir-col" key={section.id}>
            <header><Link to={section.items[0]!.to}>{section.name}</Link><span>{section.items.length} PAGES</span></header>
            <nav aria-label={section.name}>
              {section.items.map((item) => isFile(item.to) ? <a key={item.to} href={item.to}>{item.label}</a> : <Link key={item.to} to={item.to}>{item.label}</Link>)}
            </nav>
          </div>
        ))}
      </div>
    </div>
  );
}
