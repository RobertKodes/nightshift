import { safeHref } from "./safe";

/** The IMD address and a way to open it if that address fails. */
export function SiteLinks({ site, backup, className }: { site?: string | null; backup?: string | null; className?: string }) {
  if (!site) return null;
  return <>
    <a className={className} href={safeHref(site)} target="_blank" rel="noreferrer">Site ↗</a>
    {backup && <> · <a className={className} href={safeHref(backup)} target="_blank" rel="noreferrer">Backup link (if the site does not open) ↗</a></>}
  </>;
}
