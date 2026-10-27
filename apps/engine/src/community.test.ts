import { describe, expect, it } from "vitest";
import { bskyFresh } from "./community.js";

const post = (id: string, at: string) => ({ post: { uri: `at://did/app.bsky.feed.post/${id}`, record: { createdAt: at } } });
const now = Date.parse("2026-10-28T12:00:00Z");
const ids = (list: { post: { uri: string } }[]) => list.map((f) => f.post.uri.split("/").pop());

describe("the Bluesky relay", () => {
  it("brings each post to the chat once, however the feed answers", () => {
    const a = post("a", "2026-10-27T15:00:00Z"), b = post("b", "2026-10-27T13:00:00Z"), c = post("c", "2026-10-27T01:00:00Z");
    const st: { bskySeen?: string; bskyAt?: string; bskyPosted?: string[] } = { bskySeen: a.post.uri };
    // the first look after the update only remembers what is there
    expect(bskyFresh(st, [a, b, c], now)).toEqual([]);
    // a feed that leaves out its newest post, answers in another order or repeats itself brings nothing back
    expect(bskyFresh(st, [b, c], now)).toEqual([]);
    expect(bskyFresh(st, [c, a, b], now)).toEqual([]);
    expect(bskyFresh(st, [a, b, c], now)).toEqual([]);
    // new posts come oldest first, two at a time, then the rest on the next look
    const d = post("d", "2026-10-28T09:00:00Z"), e = post("e", "2026-10-28T10:00:00Z"), f = post("f", "2026-10-28T11:00:00Z");
    expect(ids(bskyFresh(st, [f, e, d, a, b], now))).toEqual(["d", "e"]);
    expect(ids(bskyFresh(st, [f, e, d, a, b], now))).toEqual(["f"]);
    expect(bskyFresh(st, [f, e, d, a, b], now)).toEqual([]);
    // an old post the feed shows again, or one more than a day old, is never relayed
    expect(bskyFresh(st, [post("old", "2026-10-26T10:00:00Z"), f], now)).toEqual([]);
  });
});
