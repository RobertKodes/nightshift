// The NIGHTSHIFT side: every request is signed with the keeper key (a message, not a transaction), so the
// coordinator knows which seat is asking. The key never leaves this machine.
export const SITE = (process.env.NIGHTWATCH_SITE || "https://getnightshift.tech").replace(/\/$/, "");

export const authMessage = (keeper, ts) => `NIGHT WATCH ${keeper.toLowerCase()} ${ts}`;

export async function jobs(account) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await account.signMessage({ message: authMessage(account.address, ts) });
  const r = await fetch(`${SITE}/api/watch/jobs`, {
    headers: { accept: "application/json", "x-keeper": account.address, "x-ts": String(ts), "x-sig": sig, "user-agent": "nightwatch/1" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `coordinator answered ${r.status}`), { status: r.status });
  return body;
}

export const pairLink = (keeper) => `${SITE}/watch?pair=${keeper}`;
