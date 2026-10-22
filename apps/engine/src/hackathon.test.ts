import { describe, expect, it } from "vitest";
import { hackathonNews, judgingNews } from "./hackathon.js";

const ours = { id: "35ac", project: "nightshiftimd", about: "NIGHTSHIFT runs on IMD", deployer: "0x12c6", contract: "0xe5e5", chains: ["ethereum"], createdAt: "2026-10-19", personal: "x" };
const other = (n: number) => ({ id: `o${n}`, project: `p${n}`, about: "x", deployer: "0x1", contract: "", chains: [], createdAt: "2026-10-20", personal: "" });

describe("the hackathon watcher", () => {
  it("is quiet on the first look and when nothing changed", () => {
    const a = hackathonNews(null, [ours, other(1)]);
    expect(a.news).toEqual([]);
    expect(hackathonNews(a.seen, [ours, other(1)]).news).toEqual([]);
  });
  it("tells when results fields appear, with our place", () => {
    const a = hackathonNews(null, [ours, other(1)]);
    const b = hackathonNews(a.seen, [{ ...ours, place: 7 }, { ...other(1), place: 3 }]);
    expect(b.news.map((n) => n.kind)).toEqual(["results"]);
    expect(b.news[0]!.text).toContain("place: 7");
  });
  it("tells when our payout address or text changes, or our entry disappears", () => {
    const a = hackathonNews(null, [ours, other(1)]);
    const b = hackathonNews(a.seen, [{ ...ours, deployer: "0x6c4c" }, other(1)]);
    expect(b.news[0]!.text).toContain("deployer changed: 0x12c6 → 0x6c4c");
    expect(hackathonNews(a.seen, [other(1)]).news.map((n) => n.kind)).toEqual(["removed"]);
  });
  it("says when the field grows by five or more", () => {
    const a = hackathonNews(null, [ours]);
    const b = hackathonNews(a.seen, [ours, other(1), other(2), other(3), other(4), other(5)]);
    expect(b.news.map((n) => n.text)).toEqual(["🏆 IMD Radar hackathon: 6 entries now (+5)."]);
  });
});

describe("the hackathon judging watcher", () => {
  const test = { id: "t1", status: "disagreed", question: "TESTING. Select the 15 highest-scoring eligible hackathon submissions using only the section" };
  const real = { id: "r1", status: "pending", question: "Select the 15 highest-scoring eligible hackathon submissions using only the section" };
  const other = { id: "o1", status: "attested", question: "Did the wallet 0x9464 hold IMD?" };
  it("learns quietly on the first look, then tells test runs privately and the real judging publicly", () => {
    const a = judgingNews(null, [test, other]);
    expect([...a.pub, ...a.priv]).toEqual([]);
    const b = judgingNews(a.seen, [test, { ...test, id: "t2" }, real, other]);
    expect(b.priv).toHaveLength(1);
    expect(b.pub).toHaveLength(1);
    expect(b.pub[0]).toContain("THE SWARM IS JUDGING THE IMD RADAR HACKATHON");
    const c = judgingNews(b.seen, [{ ...real, status: "attested" }]);
    expect(c.pub[0]).toContain("FINISHED JUDGING");
    expect(judgingNews(c.seen, [{ ...real, status: "attested" }]).pub).toEqual([]);
  });
});
