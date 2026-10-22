import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const read = (f) => readFileSync(path(f), "utf8");
const sh = read("vps-setup.sh");

test("vps-setup.sh is valid bash", (t) => {
  const r = spawnSync("bash", ["-n", path("vps-setup.sh")], { encoding: "utf8" });
  if (r.error) return t.skip("bash not available");
  assert.equal(r.status, 0, r.stderr);
});

test("the service starts report-only and runs unprivileged", () => {
  const unit = sh.split("cat > /etc/systemd/system/nightwatch.service")[1].split("\nUNIT")[0];
  const exec = unit.split("\n").find((l) => l.startsWith("ExecStart=")) ?? "";
  assert.match(exec, /bot\.mjs$/);
  assert.doesNotMatch(exec, /--execute/);
  assert.match(unit, /^User=\$U$/m);
});

test("the key is made on the server with mode 600 and never sent anywhere", () => {
  assert.match(sh, /umask 077/);
  assert.match(sh, /openssl rand -hex 32/);
  for (const l of sh.split("\n").filter((x) => /curl/.test(x) && !x.trim().startsWith("#"))) assert.doesNotMatch(l, /KEEPER_PRIVATE_KEY|\.env/);
});

test("cloud-init is a cloud-config that runs the setup script", () => {
  const y = read("cloud-init.yaml");
  assert.match(y, /^#cloud-config/);
  assert.match(y, /nightwatch\/vps-setup\.sh/);
  assert.ok(Buffer.byteLength(y) < 32 * 1024);
});

test("every file the setup downloads is one the site serves", () => {
  const served = readFileSync(fileURLToPath(new URL("../../apps/engine/src/watch-routes.ts", import.meta.url)), "utf8");
  for (const f of sh.match(/^FILES="([^"]+)"/m)[1].split(" ")) assert.ok(served.includes(`"${f}"`), f);
  assert.ok(served.includes('"vps-setup.sh"') && served.includes('"cloud-init.yaml"'));
});
