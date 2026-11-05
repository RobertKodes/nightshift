import { Link } from "../router";
import { itemPath, SECTIONS, sectionPath, type SiteSection } from "../site/sitemap";
import { PxHero, PxNum, PxStat, PxStats, PxTag } from "./kit";
import { NAV } from "./nav";
import { PxIcon } from "./PxIcon";
import { LxBg, LxStar, useRich } from "./pages/learn-kit";
import "./saas.css";
import "./pages/learn.css";

const WALLET_LABEL = { none: "NO WALLET", optional: "WALLET OPTIONAL", required: "WALLET NEEDED" } as const;
const WALLET_TONE = { none: "lime", optional: "dim", required: "gold" } as const;

/** The whole protocol in one place: every section, every page, one block. */
export function SxIndex() {
  const rich = useRich();
  const pages = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  const free = SECTIONS.reduce((n, s) => n + s.items.filter((i) => i.wallet === "none").length, 0);
  return (
    <div className="lx lx-index">
      <PxHero
        kicker="INDEX"
        title="Every"
        accent="page."
        bg={<LxBg rich={rich} />}
        lead="The whole protocol, grouped the way a person thinks. Nothing on this site is more than two clicks from here."
        actions={<>
          <LxStar to="/launch" icon="blocks">START A COMPANY</LxStar>
          <Link to="/start" className="px-btn"><PxIcon name="doc" size={14} />5-MINUTE GUIDE</Link>
          <Link to="/" className="px-btn ghost">BACK TO THE FRONT</Link>
        </>}
        aside={<>
          <PxStats cols={3}>
            <PxStat label="Pages" value={<PxNum value={pages} />} sub="in this index" tone="lime" />
            <PxStat label="Sections" value={<PxNum value={SECTIONS.length} />} sub="grouped by job" />
            <PxStat label="No wallet" value={<PxNum value={free} />} sub="pages to just read" />
          </PxStats>
          <div className="lx-note">
            <span><b>{pages}</b> PAGES IN <b>{SECTIONS.length}</b> SECTIONS</span>
            <span>FREE TO READ: <b>NO WALLET</b> UNLESS A PAGE SAYS SO</span>
          </div>
        </>}
      />
      <div className="lx-dir">
        {SECTIONS.map((section) => (
          <div className="lx-dir-col" key={section.id}>
            <header><Link to={sectionPath(section)}>{section.name}</Link><span>{section.items.length} PAGES</span></header>
            <nav aria-label={section.name}>
              {section.items.map((item) => <a key={item.path} href={itemPath(item)}>{item.title}</a>)}
            </nav>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One section of the protocol: quick actions, then every page in it. */
export function SxSection({ section }: { section: SiteSection }) {
  const rich = useRich();
  const groups = [...new Set(section.items.map((item) => item.group ?? "More"))];
  const next = SECTIONS.filter((s) => s.id !== section.id);
  const nav = NAV.find((group) => group.id === section.id);
  const free = section.items.filter((item) => item.wallet === "none").length;
  return (
    <div className="lx lx-index lx-hub">
      <PxHero
        kicker={section.name.toUpperCase()}
        title={section.id === "frogs" ? <img className="lx-hub-frog" src="/frogs/frog-001.webp" alt="" width={42} height={42} /> : undefined}
        accent={section.name}
        bg={<LxBg rich={rich} />}
        lead={section.line}
        actions={<>
          {section.actions.map((action, index) => (
            <Link key={action.path} to={action.path} className={index === 0 ? "px-btn primary" : "px-btn"}>{action.title.toUpperCase()}</Link>
          ))}
        </>}
        aside={<>
          <PxStats cols={2}>
            <PxStat label="Pages" value={<PxNum value={section.items.length} />} sub="in this section" tone="lime" />
            <PxStat label="No wallet" value={<PxNum value={free} />} sub="pages to just read" />
          </PxStats>
          <div className="lx-note">
            <span><b>{section.items.length}</b> PAGES</span>
            <span>FREE TO READ: <b>NO WALLET</b> UNLESS A PAGE SAYS SO</span>
            {nav && <span>START WITH <b>{nav.links[0]?.label.toUpperCase()}</b></span>}
          </div>
        </>}
      />

      {groups.map((group, index) => {
        const items = section.items.filter((item) => (item.group ?? "More") === group);
        return (
          <section className="lx-hub-group" key={group} aria-labelledby={`px-hub-${section.id}-${index}`}>
            <h2 id={`px-hub-${section.id}-${index}`}>{group}</h2>
            <div className="lx-hub-grid">
              {items.map((item) => (
                <a key={item.path} className="lx-hub-card" href={itemPath(item)}>
                  <b>{item.title}<PxIcon name="arrow" size={12} /></b>
                  <p>{item.line}</p>
                  <PxTag tone={WALLET_TONE[item.wallet]}>{WALLET_LABEL[item.wallet]}</PxTag>
                </a>
              ))}
            </div>
          </section>
        );
      })}

      <nav className="lx-hub-next" aria-label="Other sections">
        <b>KEEP GOING</b>
        {next.map((other) => <Link key={other.id} to={sectionPath(other)} className="px-btn small">{other.name.toUpperCase()} →</Link>)}
        <Link to="/new" className="px-btn small ghost">ALL SECTIONS</Link>
      </nav>
    </div>
  );
}
