import { config } from "./config.js";
import { Engine } from "./engine.js";
import { serve } from "./server.js";
import { ADMIN } from "./admin.js";
import { live as gameLobby } from "./games-routes.js";

const engine = new Engine();
// Real funds need the vault key outside the data folder: a copy of the volume or a backup alone
// must not be enough to decrypt the company wallets.
if (engine.vault.generatedSecret && config.mode === "live") {
  console.error("Refusing to run in live mode: set NIGHTSHIFT_SECRET (kept outside the data volume) so wallet keys are not stored next to their key.");
  process.exit(1);
}
await engine.start();
serve(engine);
// The stakes lobby follows the escrow from the start, so a deposit is never waiting on a page visit.
gameLobby(engine.vault);
console.log(`Setup dashboard: ${config.publicUrl}/setup  admin token: ${ADMIN.generated ? "in data/admin-token" : "(from ADMIN_TOKEN)"}`);
