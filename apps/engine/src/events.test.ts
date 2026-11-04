import { describe, expect, it } from "vitest";
import { EventLog, StreamCount } from "./events.js";

const ev = (companyId: string, n: number) => ({ companyId, n });

describe("the live feed's memory", () => {
  it("gives a reader that reconnects only what it missed, for its company", () => {
    const log = new EventLog<ReturnType<typeof ev>>(500, 1000);
    const a1 = log.push(ev("a", 1));
    log.push(ev("b", 1));
    log.push(ev("a", 2));
    log.push(ev("a", 3));
    const r = log.since("a", a1);
    expect(r.reset).toBe(false);
    expect(r.events.map((x) => x.e.n)).toEqual([2, 3]);
    expect(log.since("b", a1).events.map((x) => x.e.n)).toEqual([1]);
    // nothing new: nothing sent, no reset
    expect(log.since("a", r.events.at(-1)!.id)).toEqual({ events: [], reset: false });
  });

  it("tells the reader to reload after a restart or when what it missed is no longer kept", () => {
    const before = new EventLog<ReturnType<typeof ev>>(500, 1000);
    const old = before.push(ev("a", 1));
    const after = new EventLog<ReturnType<typeof ev>>(500, 2000);
    after.push(ev("a", 2));
    expect(after.since("a", old).reset).toBe(true);
    expect(after.since("a", "junk").reset).toBe(true);

    const small = new EventLog<ReturnType<typeof ev>>(3, 1000);
    const first = small.push(ev("a", 1));
    for (let i = 2; i <= 6; i++) small.push(ev("a", i));
    const r = small.since("a", first);
    expect(r.reset).toBe(true);
    expect(r.events.map((x) => x.e.n)).toEqual([4, 5, 6]);
  });

  it("drops a deleted company's events", () => {
    const log = new EventLog<ReturnType<typeof ev>>(500, 1000);
    const id = log.push(ev("a", 1));
    log.push(ev("a", 2));
    log.drop("a");
    expect(log.since("a", id).events).toEqual([]);
  });
});

describe("open live streams", () => {
  it("counts signed-in owners apart from their IP, so phones behind one carrier IP all connect", () => {
    const s = new StreamCount(12, 6, 2000);
    const slots = Array.from({ length: 7 }, (_, i) => s.take(`0xowner${i}`, "100.64.0.1"));
    expect(slots.every(Boolean)).toBe(true);
    // anonymous readers on that IP still have their own six
    for (let i = 0; i < 6; i++) expect(s.take(null, "100.64.0.1")).not.toBeNull();
    expect(s.take(null, "100.64.0.1")).toBeNull();
  });

  it("caps one owner, frees a slot on close, and holds the total", () => {
    const s = new StreamCount(2, 6, 3);
    const a = s.take("0xme", "1.1.1.1")!;
    s.take("0xme", "2.2.2.2");
    expect(s.take("0xme", "3.3.3.3")).toBeNull();
    s.release(a);
    expect(s.take("0xme", "3.3.3.3")).not.toBeNull();
    expect(s.take("0xyou", "4.4.4.4")).not.toBeNull();
    expect(s.total).toBe(3);
    // the whole engine is full
    expect(s.take("0xthird", "5.5.5.5")).toBeNull();
    expect(new StreamCount(12, 6, 10).take(null, "pb:5.5.5.5", 0)).toBeNull();
  });
});
