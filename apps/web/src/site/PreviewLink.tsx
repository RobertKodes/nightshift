import type { AnchorHTMLAttributes } from "react";
import { go } from "../router";

/** Preview navigation stays in the app; existing pages keep their own entry points. */
export function PreviewLink({ href = "/new", onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0 && /^\/new(?:\/|$)/.test(href)) {
      event.preventDefault(); go(href);
    }
  }} />;
}
