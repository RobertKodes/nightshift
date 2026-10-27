import { describe, expect, it } from "vitest";
import { parseSub, pushEndpoint } from "./push.js";

const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

describe("app notifications", () => {
  it("takes subscriptions from the browsers' push services only", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc:def", "https://updates.push.services.mozilla.com/wpush/v2/gAAA", "https://web.push.apple.com/QK1x", "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA"]) {
      expect(pushEndpoint(ok)).toBe(true);
      expect(parseSub({ endpoint: ok, keys })).toMatchObject({ endpoint: ok });
    }
    for (const bad of ["https://127.0.0.1:8443/private-action", "https://attacker.example/push", "https://fcm.googleapis.com:8443/fcm/send/x", "https://user:pw@fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.attacker.example/x", "http://fcm.googleapis.com/fcm/send/x"]) {
      expect(pushEndpoint(bad)).toBe(false);
      expect(parseSub({ endpoint: bad, keys })).toBeNull();
    }
  });
});
