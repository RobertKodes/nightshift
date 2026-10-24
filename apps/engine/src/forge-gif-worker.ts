import type { Forged } from "./forge.js";
import { watcherGif } from "./forge-gif.js";

/** Makes Night Watcher GIFs in their own process (each takes about 20 s of drawing), then exits. */
process.once("message", (m: { forged: Forged[] }) => {
  for (const f of m.forged) {
    try { watcherGif(f); } catch (e) { console.error("forge gif", f.n, (e as Error).message); }
  }
  process.exit(0);
});
