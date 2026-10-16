import { config } from "./config.js";
import { Engine } from "./engine.js";
import { serve } from "./server.js";
import { ADMIN } from "./admin.js";

const engine = new Engine();
await engine.start();
if (engine.vault.generatedSecret && config.mode === "live") {
  console.warn("WARNING: NIGHTSHIFT_SECRET is not set; wallet keys are encrypted with a generated key in the data folder. Set it before holding real funds.");
}
serve(engine);
console.log(`Setup dashboard: ${config.publicUrl}/setup  admin token: ${ADMIN.generated ? ADMIN.token : "(from ADMIN_TOKEN)"}`);
