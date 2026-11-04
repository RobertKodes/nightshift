import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Fcm, type FcmNote, type Transport, message, serviceAccount } from "./push-fcm.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { project_id: "nightshift-test", client_email: "push@nightshift-test.iam.gserviceaccount.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
const note: FcmNote = { kind: "approval", title: "✋ Tidewell needs your approval", body: "Improve the site. $7.68: over your $5 limit.", url: "nightshift://approve/co1/t1", companyId: "co1", taskId: "t1", tag: "approval-t1" };

/** A fake Google: signs in once, then answers each send by token. */
function google(answers: Record<string, { status: number; body?: unknown }> = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.includes("oauth2")) return { status: 200, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }) };
    const token = (JSON.parse(init.body) as { message: { token: string } }).message.token;
    const a = answers[token] ?? { status: 200, body: { name: "projects/x/messages/1" } };
    return { status: a.status, json: async () => a.body ?? {} };
  };
  return { calls, transport };
}

describe("push to the owner's phones", () => {
  it("reads the service account and refuses anything else", () => {
    expect(serviceAccount(JSON.stringify(account))?.project_id).toBe("nightshift-test");
    expect(serviceAccount("")).toBeNull();
    expect(serviceAccount("{not json")).toBeNull();
    expect(serviceAccount(JSON.stringify({ ...account, private_key: "x" }))).toBeNull();
  });

  it("signs in with a JWT the service account signed, once, then sends to each token", async () => {
    const g = google();
    const fcm = new Fcm({ account: () => account, transport: g.transport });
    expect(await fcm.send(["tokA", "tokB"], note)).toBe(2);
    expect(await fcm.send(["tokC"], note)).toBe(1);
    const signins = g.calls.filter((c) => c.url.includes("oauth2"));
    expect(signins).toHaveLength(1);
    const jwt = new URLSearchParams(signins[0]!.body).get("assertion")!;
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    const send = g.calls.find((c) => c.url.includes("messages:send"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/nightshift-test/messages:send");
    expect(send.headers.Authorization).toBe("Bearer ya29.test");
  });

  it("drops tokens FCM says are gone, and keeps the rest", async () => {
    const g = google({ gone: { status: 404, body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } } }, busy: { status: 503 } });
    const fcm = new Fcm({ account: () => account, transport: g.transport });
    const gone: string[] = [];
    fcm.onGone = (t) => gone.push(t);
    expect(await fcm.send(["ok", "gone", "busy"], note)).toBe(1);
    expect(gone).toEqual(["gone"]);
  });

  it("does nothing without a service account", async () => {
    const g = google();
    const fcm = new Fcm({ account: () => null, transport: g.transport });
    expect(fcm.ready).toBe(false);
    expect(await fcm.send(["tok"], note)).toBe(0);
    expect(g.calls).toHaveLength(0);
  });

  it("sends a data message the app presents itself: approvals loud, with buttons, and only ids and a line of text", () => {
    const m = message("tok", note);
    expect(m.android.priority).toBe("HIGH");
    expect(m.data).toMatchObject({ title: note.title, message: note.body, channelId: "approvals", categoryId: "approval" });
    expect(JSON.parse(m.data.body)).toEqual({ url: "nightshift://approve/co1/t1", kind: "approval", companyId: "co1", taskId: "t1" });
    for (const v of Object.values(m.data)) expect(typeof v).toBe("string");
    const sale = message("tok", { ...note, kind: "sale", taskId: undefined });
    expect(sale.android.priority).toBe("NORMAL");
    expect(sale.data.channelId).toBe("activity");
    expect("categoryId" in sale.data).toBe(false);
  });
});
