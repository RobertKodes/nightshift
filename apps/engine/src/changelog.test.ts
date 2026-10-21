import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WeeklyChangelog, changelog, parseChangelog, weekCard, weekEntries } from "./changelog.js";
import { setTelegramTransport } from "./social.js";

const MD = `# NIGHTSHIFT changelog

What shipped, newest first.

## 2026-10-26 · Next week's thing
- Not in last week's post.

## 2026-10-21 · Rewards hub on the front page
- One place to claim.
- The IMD burn bar.
- A leaner keeper.
- A fourth line is never read.

## 2026-10-19 · NIGHT CHESS
- 3D chess with ratings.

## Notes without a date
- not an entry

## 2026-10-12 · The week before
- Older.
`;
const MONDAY = Date.UTC(2026, 9, 26); // Mon 26 Oct 2026, 00:00 UTC

describe("the changelog", () => {
  afterEach(() => setTelegramTransport(null));

  it("parses entries newest first, one to three lines each, and skips headings without a date", () => {
    const e = parseChangelog(MD.replace(/\n/g, "\r\n"));
    expect(e.map((x) => x.date)).toEqual(["2026-10-26", "2026-10-21", "2026-10-19", "2026-10-12"]);
    expect(e[1]).toEqual({ date: "2026-10-21", title: "Rewards hub on the front page", lines: ["One place to claim.", "The IMD burn bar.", "A leaner keeper."] });
    expect(e[3]!.lines).toEqual(["Older."]);
  });

  it("the repository's own docs/CHANGELOG.md parses: dated, newest first, 1 to 3 lines per entry", () => {
    const { entries } = changelog();
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title && e.lines.length >= 1 && e.lines.length <= 3)).toBe(true);
    expect([...entries].sort((a, b) => b.date.localeCompare(a.date)).map((e) => e.date)).toEqual(entries.map((e) => e.date));
  });

  it("picks the past week (Monday to Sunday) and makes one message that fits Telegram", () => {
    const week = weekEntries(parseChangelog(MD), MONDAY);
    expect(week.map((e) => e.title)).toEqual(["Rewards hub on the front page", "NIGHT CHESS"]);
    const card = weekCard(week, MONDAY, "https://getnightshift.tech")!;
    expect(card.text).toContain("THIS WEEK ON NIGHTSHIFT</b> · 19 Oct to 25 Oct");
    expect(card.text).toContain("<b>Rewards hub on the front page</b> · 21 Oct\n• One place to claim.");
    expect(card.buttons[0]![0]!.url).toBe("https://getnightshift.tech/changelog");
    expect(weekCard([], MONDAY)).toBeNull();
    // a long week falls back to titles, and always fits one message
    const many = Array.from({ length: 80 }, (_, i) => ({ date: "2026-10-20", title: `Update number ${i} with a fairly long title`, lines: ["A line that is quite long, to fill the message up quickly and then some more words."] }));
    const long = weekCard(many, MONDAY)!;
    expect(long.text.length).toBeLessThanOrEqual(3800);
    expect(long.text).toMatch(/…and \d+ more on the changelog page\./);
  });

  it("posts on Monday at 09:00 UTC, pins it and unpins last week's; once a week; sim mode only logs", async () => {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    let id = 100;
    setTelegramTransport(async (url, init) => {
      const method = url.split("/").pop()!;
      calls.push({ method, body: JSON.parse(init.body ?? "{}") });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: method === "sendMessage" ? { message_id: ++id } : true }) };
    });
    const dir = mkdtempSync(join(tmpdir(), "changelog-"));
    let now = MONDAY + 8 * 3_600_000; // 08:00
    const entries = () => parseChangelog(MD);
    const opts = { entries, now: () => now, on: () => true, token: () => "1:x", chats: () => ["@getnightshift"], file: join(dir, "changelog.json"), dryRun: join(dir, "dry.log") };
    const w = new WeeklyChangelog({ ...opts, mode: () => "live" });
    expect(await w.tick()).toBe("wait");
    now = MONDAY + 9 * 3_600_000 + 30_000;
    expect(await w.tick()).toBe("sent");
    expect(calls.map((c) => c.method)).toEqual(["sendMessage", "pinChatMessage"]);
    expect(calls[1]!.body).toMatchObject({ chat_id: "@getnightshift", message_id: 101 });
    expect(await w.tick()).toBe("wait");
    // the next Monday: a new post pinned, last week's unpinned (after a restart too)
    now += 7 * 86_400_000;
    const next = new WeeklyChangelog({ ...opts, entries: () => [{ date: "2026-10-28", title: "Weekly prizes", lines: ["Shift hours for the best players."] }], mode: () => "live" });
    expect(await next.tick()).toBe("sent");
    expect(calls.slice(2).map((c) => [c.method, c.body.message_id ?? null])).toEqual([["sendMessage", null], ["pinChatMessage", 102], ["unpinChatMessage", 101]]);
    // a week with nothing shipped: no post
    now += 7 * 86_400_000;
    expect(await new WeeklyChangelog({ ...opts, mode: () => "live" }).tick()).toBe("empty");
    expect(calls).toHaveLength(5);
    // sim mode: never Telegram, only the dry-run log
    const sim = new WeeklyChangelog({ ...opts, now: () => MONDAY + 9 * 3_600_000, file: join(dir, "sim.json"), mode: () => "sim" });
    expect(await sim.tick()).toBe("dry-run");
    expect(calls).toHaveLength(5);
    expect(readFileSync(join(dir, "dry.log"), "utf8")).toContain("not posted, not pinned");
    expect(await new WeeklyChangelog({ ...opts, on: () => false }).tick()).toBe("off");
  });
});
