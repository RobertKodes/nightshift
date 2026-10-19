import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { pinned, privateIp, safeFetch } from "./net.js";

describe("fetching untrusted URLs", () => {
  it("treats every non-public range as private, IPv4-mapped forms included", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.18.0.2", "192.168.1.1", "100.64.0.1", "192.0.0.8", "198.18.0.1", "198.19.255.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:a9fe:a9fe]", "64:ff9b::7f00:1"])
      expect(privateIp(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"]) expect(privateIp(ip), ip).toBe(false);
  });

  it("refuses private hosts, odd ports and credentials before connecting", async () => {
    for (const u of ["http://127.0.0.1/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://example.com:8080/", "http://a:b@example.com/", "file:///etc/passwd"])
      expect(await safeFetch(u), u).toBeNull();
  });

  it("connects to the vetted address, not to a second DNS answer, keeping the URL's Host", async () => {
    const srv = createServer((req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end(`host=${req.headers.host}`); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as AddressInfo;
    // the name does not resolve at all: only the pinned address can answer
    const r = await pinned(new URL(`http://pinned.invalid:${port}/x`), "127.0.0.1", 4, {});
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(`host=pinned.invalid:${port}`);
    srv.close();
  });
});
