import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { NIGHT_FROGS } from "./order-night-frogs.js";

/**
 * Work the operator buys from IMD with their own wallet, outside any company: the browser pays
 * the Intake (approve, then request); the server only checks the body for free, records the
 * transaction and follows it (intake → job → launch) so Telegram can tell every stage.
 */
export type Catalog = { id: string; title: string; summary: string; action: string; actionId: string; body: Record<string, unknown> };
export const CATALOG: Catalog[] = [
  {
    id: "night-frogs",
    title: "NIGHT FROGS · onchain NFT collection",
    summary: "500 fully onchain layered frogs (77 Genesis), Chainlink VRF reveal, minted only in IMD at 2 IMD: 50% burned to 0x…dEaD, 50% to you. Built, tested, audited by 4 agents and a judge, then deployed by IMD on Ethereum.",
    action: "launch.open",
    actionId: "launch.open@launch-1",
    body: NIGHT_FROGS as unknown as Record<string, unknown>,
  },
];

export type Order = {
  id: string; title: string; tx: string; at: number; stage: string; done?: boolean; error?: string;
  jobId?: string; launchId?: string; repoUrl?: string; addresses?: { role: string; name?: string; address: string }[];
};
const file = () => join(config.dataDir, "orders.json");
export function orders(): Order[] { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : []; } catch { return []; } }
const save = (o: Order[]) => writeFileSync(file(), JSON.stringify(o, null, 2));

export async function checkOrder(c: Catalog): Promise<unknown> {
  const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: c.action, input: c.body }), signal: AbortSignal.timeout(180_000) });
  return r.json();
}

export function recordOrder(c: Catalog, tx: string): Order {
  const o: Order = { id: c.id, title: c.title, tx, at: Date.now(), stage: "Waiting for IMD to see the payment" };
  save([o, ...orders().filter((x) => x.tx !== tx)]);
  return o;
}

/** One step of following every open order. Returns the ones whose stage changed. */
export async function followOrders(): Promise<Order[]> {
  const all = orders();
  const changed: Order[] = [];
  const get = async (u: string) => { const r = await fetch(`https://api.imd.fun${u}`, { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : null; };
  for (const o of all) {
    if (o.done) continue;
    const before = o.stage;
    try {
      if (!o.jobId) {
        const i = (await get(`/intake/1/${o.tx}`)) as { entries?: { state?: string; reason?: string; admission?: { result?: { jobId?: string } } }[] } | null;
        const e = i?.entries?.[0];
        if (e?.admission?.result?.jobId) Object.assign(o, { jobId: e.admission.result.jobId, stage: "Admitted: the swarm is planning the work" });
        else if (e?.state && /refus|fail/i.test(e.state)) Object.assign(o, { stage: `IMD refused it: ${e.reason ?? e.state}`, error: e.reason ?? e.state, done: true });
        else if (e) o.stage = `IMD saw the payment (${e.state ?? "pending"})`;
      }
      if (o.jobId && !o.done) {
        const j = (await get(`/jobs/${o.jobId}`)) as { state?: string; nodes?: { state: string; skill?: string }[]; delivery?: { repoUrl?: string }; launch?: { id?: string } } | null;
        const n = j?.nodes ?? [];
        const accepted = n.filter((x) => x.state === "accepted").length;
        if (j?.delivery?.repoUrl) o.repoUrl = j.delivery.repoUrl;
        if (j?.launch?.id) o.launchId = j.launch.id;
        if (!o.launchId) {
          const res = (await get(`/jobs/${o.jobId}/result`)) as { launch?: { id?: string } } | null;
          if (res?.launch?.id) o.launchId = res.launch.id;
        }
        if (j?.state === "failed" || j?.state === "cancelled" || j?.state === "blocked") Object.assign(o, { stage: `The swarm job is ${j.state}`, error: j.state, done: true });
        else if (!o.launchId) o.stage = `The swarm is building, testing and auditing (${accepted}/${n.length} steps)`;
      }
      if (o.launchId && !o.done) {
        const L = (await get(`/launches/${o.launchId}`)) as { status?: string; artifacts?: { role: string; name?: string; address: string }[] } | null;
        o.stage = L?.status === "live" ? "Live on Ethereum" : `Deploying (${L?.status ?? "…"})`;
        if (L?.artifacts?.length) o.addresses = L.artifacts.map((a) => ({ role: a.role, name: a.name, address: a.address }));
        if (L?.status === "live") o.done = true;
      }
    } catch (e) { o.stage = `${before.replace(/ \(retrying.*$/, "")} (retrying: ${(e as Error).message.slice(0, 60)})`; }
    if (o.stage !== before && !o.stage.includes("retrying")) changed.push(o);
  }
  save(all);
  return changed;
}
