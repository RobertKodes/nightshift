/// <reference lib="webworker" />
/**
 * Hash Lab miner: a birthday search for two messages whose SHA-256 (first `rounds` rounds) digests
 * share the most leading bits. Every message is "NS|<player>|" + 8 counter bytes, one 64-byte block.
 * A 4M-slot table keyed by the digest's top 22 bits remembers the latest message per slot; a slot
 * whose stored top 32 bits match is a pair of at least 32 bits, scored on the next 32.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SLOTS_LOG = 22;
const keys = new Uint32Array(1 << SLOTS_LOG), lows = new Uint32Array(1 << SLOTS_LOG), hiC = new Uint32Array(1 << SLOTS_LOG), loC = new Uint32Array(1 << SLOTS_LOG);
const W = new Uint32Array(64);
const block = new Uint8Array(64);
const view = new DataView(block.buffer);
let running = false;

type Start = { type: "start"; player: string; rounds: number; seed: number; best: number };

function hashInto(rounds: number, out: Uint32Array) {
  for (let t = 0; t < 16; t++) W[t] = view.getUint32(t * 4);
  for (let t = 16; t < 64; t++) {
    const a = W[t - 15]!, b = W[t - 2]!;
    W[t] = (W[t - 16]! + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + W[t - 7]! + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0;
  }
  let a = 0x6a09e667 | 0, b = 0xbb67ae85 | 0, c = 0x3c6ef372 | 0, d = 0xa54ff53a | 0, e = 0x510e527f | 0, f = 0x9b05688c | 0, g = 0x1f83d9ab | 0, h = 0x5be0cd19 | 0;
  for (let t = 0; t < rounds; t++) {
    const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = (a + 0x6a09e667) >>> 0; out[1] = (b + 0xbb67ae85) >>> 0; out[2] = (c + 0x3c6ef372) >>> 0;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");

self.onmessage = (ev: MessageEvent<Start | { type: "stop" }>) => {
  const m = ev.data;
  if (m.type === "stop") { running = false; return; }
  running = true;
  const prefix = new TextEncoder().encode(`NS|${m.player.toLowerCase()}|`);
  const len = prefix.length + 8;
  if (len > 55) { postMessage({ type: "error", error: "player id too long for one block" }); return; }
  block.fill(0); block.set(prefix); block[len] = 0x80; view.setUint32(60, len * 8);
  keys.fill(0); hiC.fill(0); loC.fill(0);
  const out = new Uint32Array(3);
  const msg = (hi: number, lo: number) => { const x = new Uint8Array(len); x.set(prefix); const v = new DataView(x.buffer); v.setUint32(prefix.length, hi); v.setUint32(prefix.length + 4, lo); return hex(x); };
  let hi = m.seed >>> 0, lo = 1, total = 0, best = m.best, last = performance.now(), since = 0;
  const loop = () => {
    if (!running) return;
    const until = performance.now() + 120;
    while (performance.now() < until) {
      for (let i = 0; i < 4096; i++) {
        view.setUint32(prefix.length, hi); view.setUint32(prefix.length + 4, lo);
        hashInto(m.rounds, out);
        const s = out[0]! >>> (32 - SLOTS_LOG);
        if (keys[s] === out[0] && (hiC[s] !== 0 || loC[s] !== 0)) {
          const x = (lows[s]! ^ out[1]!) >>> 0;
          const bits = 32 + (x === 0 ? 32 : Math.clz32(x));
          if (bits > best) { best = bits; postMessage({ type: "found", bits, m1: msg(hiC[s]!, loC[s]!), m2: msg(hi, lo) }); }
        }
        keys[s] = out[0]!; lows[s] = out[1]!; hiC[s] = hi; loC[s] = lo;
        lo = (lo + 1) >>> 0; if (lo === 0) hi = (hi + 1) >>> 0;
      }
      total += 4096; since += 4096;
    }
    const now = performance.now();
    if (now - last > 1000) { postMessage({ type: "rate", rate: Math.round((since * 1000) / (now - last)), total }); last = now; since = 0; }
    setTimeout(loop, 0);
  };
  loop();
};
