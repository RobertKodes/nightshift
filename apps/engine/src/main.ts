import { config } from "./config.js";
import { Engine } from "./engine.js";
import { serve } from "./server.js";
import { ADMIN } from "./admin.js";
import { live as gameLobby } from "./games-routes.js";
import { wireGameRoom } from "./locker-routes.js";
import { startCrew } from "./crew.js";

const engine = new Engine();
// Real funds need the vault key outside the data folder: a copy of the volume or a backup alone
// must not be enough to decrypt the company wallets.
if (engine.vault.generatedSecret && config.mode === "live") {
  console.error("Refusing to run in live mode: set NIGHTSHIFT_SECRET (kept outside the data volume) so wallet keys are not stored next to their key.");
  process.exit(1);
}
await engine.start();
// the gaming profiles follow every game from the first one: looks at the pool table, XP and badges
wireGameRoom();
serve(engine);
// The stakes lobby follows the escrow from the start, so a deposit is never waiting on a page visit.
gameLobby(engine.vault);
// The crew ledger reads IMD in the background, so the HR & Economy pages never wait on IMD.
startCrew(() => [...engine.store.companies.values()].filter((c) => !c.house).flatMap((c) => c.tasks
  .filter((t) => t.imd?.jobId && t.costImd > 0n)
  .map((t) => ({ id: t.imd!.jobId!, action: t.imd!.action, title: t.title, paidAt: new Date(t.createdAt).toISOString(), by: c.name, imd: Number(t.costImd) / 1e18 }))));
console.log(`Setup dashboard: ${config.publicUrl}/setup  admin token: ${ADMIN.generated ? "in data/admin-token" : "(from ADMIN_TOKEN)"}`);
