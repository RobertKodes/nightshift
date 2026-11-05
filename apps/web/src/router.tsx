import { forwardRef, useEffect, useState } from "react";

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

/** An in-app link. It forwards its ref and other anchor props, so components that render `as={Link}` (React Bits StarBorder) can measure it. */
export const Link = forwardRef<HTMLAnchorElement, { to: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">>(function Link({ to, children, onClick, ...rest }, ref) {
  return (
    <a ref={ref} href={to} {...rest} onClick={(e) => { onClick?.(e); if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>
      {children}
    </a>
  );
});

