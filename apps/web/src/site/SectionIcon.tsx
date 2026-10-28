import type { SectionId } from "./sitemap";

const PATHS: Record<SectionId | "search" | "arrow" | "close", string> = {
  companies: "M4 21V8l8-4 8 4v13M8 21v-8h8v8M3 21h18M8 8h.01M16 8h.01",
  tools: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6ZM10 10h4v4h-4Z",
  play: "M8 8h8c4 0 7 11 3 11-2 0-3-4-5-4h-4c-2 0-3 4-5 4-4 0-1-11 3-11ZM7 10v5M4.5 12.5h5M16 11h.01M18 14h.01",
  shift: "m13 2-8 12h6l-1 8 9-13h-6l1-7Z",
  frogs: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9M8 5.25l8 4.5",
  proof: "M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h5",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  arrow: "M4 12h16m-7-7 7 7-7 7",
  close: "m6 6 12 12M6 18 18 6",
};

/** Small line icons share the same weight at phone and desktop sizes. */
export function SectionIcon({ id }: { id: keyof typeof PATHS }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[id]} /></svg>;
}
