import { useEffect, useState } from "react";

/** A small router: /, /co/:id (the owner's view) and /c/:slug (the public page). */
export function go(path: string): void {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}

export function useRoute(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export function Link(props: { to: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={props.to} className={props.className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(props.to); }}>
      {props.children}
    </a>
  );
}

