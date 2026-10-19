import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Auth, clientIp, inNets, keyAllowed, parseNets } from "./auth.js";

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as unknown as IncomingMessage;
const cookie = (v: string) => ({ headers: { cookie: `ns_session=${encodeURIComponent(v)}` } }) as unknown as IncomingMessage;
const tmp = () => join(mkdtempSync(join(tmpdir(), "auth-test-")), "sessions.json");
const me = "0xabc0000000000000000000000000000000000009";

describe("how a caller authenticated", () => {
  it("takes a key only as Bearer, never from the cookie, and tells a key from a session", () => {
    const auth = new Auth("s3cret", [], () => {}, { file: tmp() });
    const { key } = auth.createKey(me, "agent");
    const s = auth.session(me);
    expect(auth.caller(req(key))).toEqual({ addr: me, via: "key" });
    expect(auth.caller(req(s))).toEqual({ addr: me, via: "session" });
    expect(auth.caller(cookie(s))).toEqual({ addr: me, via: "session" });
    // a leaked key planted in the cookie is nobody: it cannot mint keys or manage agents
    expect(auth.owner(cookie(key))).toBeNull();
    expect(auth.ownerSession(req(key))).toBeNull();
    expect(auth.ownerSession(cookie(s))).toBe(me);
  });

  it("lets a key reach /mcp and a few reads only", () => {
    for (const [m, p] of [["POST", "/mcp"], ["GET", "/mcp"], ["GET", "/api/companies"], ["GET", "/api/companies/abc"], ["GET", "/api/companies/abc/wallet"], ["GET", "/api/auth/me"], ["GET", "/api/events"]] as const) expect(keyAllowed(m, p), `${m} ${p}`).toBe(true);
    for (const [m, p] of [["POST", "/api/keys"], ["GET", "/api/keys"], ["POST", "/api/companies/abc/policy"], ["POST", "/api/companies/abc/withdraw"], ["POST", "/api/companies/abc/close"], ["POST", "/api/companies/abc/tasks/t/approve"], ["POST", "/api/companies/abc/social"], ["POST", "/api/companies"], ["POST", "/api/games/escrow"], ["POST", "/api/bets/ticket"], ["POST", "/api/arena/stakes/0x1/assign"], ["GET", "/api/arena/mine"], ["GET", "/api/companies/abc/products/p/download"]] as const) expect(keyAllowed(m, p), `${m} ${p}`).toBe(false);
  });

  it("keeps sign-outs across a restart, and signs a wallet out everywhere", () => {
    const file = tmp();
    const auth = new Auth("s3cret", [], () => {}, { file });
    const a = auth.session(me), b = auth.session(me, Date.now() - 1000);
    auth.revoke(cookie(a));
    expect(auth.owner(req(a))).toBeNull();
    expect(new Auth("s3cret", [], () => {}, { file }).owner(req(a))).toBeNull();
    expect(new Auth("s3cret", [], () => {}, { file }).owner(req(b))).toBe(me);
    // junk is never recorded
    auth.revoke(cookie("s.0xdead.99999999999.nope"));
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).revoked)).toHaveLength(1);
    auth.revokeAll(me);
    expect(auth.owner(req(b))).toBeNull();
    const after = new Auth("s3cret", [], () => {}, { file });
    expect(after.owner(req(b))).toBeNull();
    expect(after.owner(req(after.session(me, Date.now() + 2000)))).toBe(me);
    expect(after.owner(req(after.session("0xabc0000000000000000000000000000000000008")))).toBe("0xabc0000000000000000000000000000000000008");
  });

  it("signs sessions with SESSION_SECRET when set, apart from the vault secret", () => {
    const own = new Auth("vault", [], () => {}, { file: tmp(), sessionSecret: "a-separate-session-secret" });
    const legacy = new Auth("vault", [], () => {}, { file: tmp(), sessionSecret: "" });
    expect(legacy.owner(req(own.session(me)))).toBeNull();
    expect(own.owner(req(own.session(me)))).toBe(me);
    expect(new Auth("vault", [], () => {}, { file: tmp(), sessionSecret: "" }).owner(req(legacy.session(me)))).toBe(me);
  });

  it("writes an EIP-4361 message with an expiration the site can check", () => {
    const m = Auth.message(me, "00ff", "2026-01-01T00:00:00.000Z");
    expect(m).toContain("\nChain ID: 1\nNonce: 00ff\nIssued At: 2026-01-01T00:00:00.000Z\nExpiration Time: 2026-01-01T00:05:00.000Z");
  });
});

describe("the caller's IP behind proxies", () => {
  const at = (peer: string, xff?: string) => ({ socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { "x-forwarded-for": xff } }) as unknown as IncomingMessage;
  const nets = parseNets("127.0.0.0/8, ::1, 172.31.88.0/24");

  it("reads IPs and CIDRs, IPv4-mapped forms as IPv4", () => {
    expect(inNets("127.9.9.9", nets)).toBe(true);
    expect(inNets("::1", nets)).toBe(true);
    expect(inNets("::ffff:172.31.88.7", nets)).toBe(true);
    expect(inNets("::ffff:ac1f:5807", nets)).toBe(true);
    expect(inNets("172.31.89.7", nets)).toBe(false);
    expect(inNets("10.0.0.1", nets)).toBe(false);
    expect(inNets("not-an-ip", nets)).toBe(false);
    expect(inNets("2001:db8::5", parseNets("2001:db8::/32"))).toBe(true);
    expect(inNets("2001:db9::5", parseNets("2001:db8::/32"))).toBe(false);
    expect(parseNets("junk, 1.2.3.4/33, 10.0.0.0/8")).toHaveLength(1);
  });

  it("believes X-Forwarded-For only from a trusted proxy, and then its rightmost untrusted hop", () => {
    // straight from the internet, or from a private box that is not a listed proxy: the header is ignored
    expect(clientIp(at("203.0.113.5", "1.1.1.1"), nets)).toBe("203.0.113.5");
    expect(clientIp(at("10.0.0.7", "1.1.1.1"), nets)).toBe("10.0.0.7");
    // through Caddy: the client's own guess on the left is never believed
    expect(clientIp(at("172.31.88.2", "6.6.6.6, 203.0.113.5"), nets)).toBe("203.0.113.5");
    expect(clientIp(at("::ffff:127.0.0.1", "6.6.6.6, 203.0.113.5, 172.31.88.2"), nets)).toBe("203.0.113.5");
    expect(clientIp(at("127.0.0.1"), nets)).toBe("127.0.0.1");
    expect(clientIp(at("127.0.0.1", "172.31.88.2"), nets)).toBe("172.31.88.2");
    // the default trusts loopback only
    expect(clientIp(at("172.18.0.3", "6.6.6.6"))).toBe("172.18.0.3");
  });
});
