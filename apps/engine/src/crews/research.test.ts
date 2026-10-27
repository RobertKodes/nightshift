import { describe, expect, it } from "vitest";
import { RESEARCH_SAMPLE, ResearchError, researchReport } from "./research.js";

const NOW = Date.parse("2026-10-25T10:00:00Z");
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);
const work = (n: number, title: string, url: string, at = day("2026-10-01"), kinds = ["research"]) => ({ n, title, kinds, at, url });

/** A fake SWARM MIND: answers with what it is given, records the questions. */
function mind(ask: unknown, search: unknown = []) {
  const asked: string[] = [];
  return { asked, ask: async (q: string) => { asked.push(q); return ask; }, search: (_q: string) => search };
}

describe("research desk", () => {
  it("lists only the sources SWARM MIND returned, with explorer links, and marks citations to anything else", async () => {
    const m = mind(
      {
        answer: "Two hooks burn a share of each swap [1], and one caps it [2]. A third claim cites nothing real [3] [9].",
        sources: [
          work(1, "CappedBurnHook research", "https://explorer.imd.fun/jobs/aaa"),
          work(2, "Audit of imd/hooks", "https://explorer.imd.fun/jobs/bbb", day("2026-10-10"), ["audits"]),
          work(3, "Somewhere else", "https://evil.example/jobs/ccc"),
        ],
        ai: true,
      },
      [
        { title: "Audit of imd/hooks", kinds: ["audits"], at: day("2026-10-10"), url: "https://explorer.imd.fun/jobs/bbb" }, // already listed
        { title: "Hook fee notes", kinds: ["research"], at: day("2026-09-01"), url: "https://explorer.imd.fun/jobs/ddd" },
        { title: "Not a link", kinds: ["research"], at: 0, url: "javascript:alert(1)" },
      ],
    );
    const r = await researchReport(m, "  What   do IMD hooks burn? ", () => NOW);
    expect(m.asked).toEqual(["What do IMD hooks burn?"]);
    expect(r.sources.map((s) => [s.n, s.url, s.cited])).toEqual([
      [1, "https://explorer.imd.fun/jobs/aaa", true],
      [2, "https://explorer.imd.fun/jobs/bbb", true],
      [4, "https://explorer.imd.fun/jobs/ddd", false],
    ]);
    expect(r.answer).toContain("[1]");
    expect(r.answer).toContain("[2]");
    expect(r.answer).not.toMatch(/\[3\]|\[9\]/);
    expect(r.answer).toContain("[?]");
    expect(r.gaps.join(" ")).toContain("[3], [9]");
    expect(r.gaps.join(" ")).toContain("2 results without an explorer.imd.fun link were left out");
    expect(r.coverage).toBe("3 published works from SWARM MIND (research 2, audits 1), dated 2026-09-01 to 2026-10-10; 2 cited in the answer.");
    expect(r).not.toHaveProperty("model");
    // every link in the report is one of the listed sources
    const links = [...r.markdown.matchAll(/\]\((https?:[^)]+)\)/g)].map((x) => x[1]);
    expect(links).toEqual(r.sources.map((s) => s.url));
    expect(r.markdown).not.toContain("evil.example");
  });

  it("gives no answer and no sources when SWARM MIND returned none, whatever the answer text says", async () => {
    const r = await researchReport(mind({ answer: "It was audited and is safe [1].", sources: [], ai: true }, []), "Is token X safe?", () => NOW);
    expect(r.sources).toEqual([]);
    expect(r.answer).not.toContain("safe [1]");
    expect(r.answer).toContain("no sourced answer");
    expect(r.coverage).toContain("no sources");
    expect(r.gaps[0]).toContain("returned no published work");
    expect(r.markdown).not.toMatch(/https?:\/\//);
  });

  it("lists the works without a written answer when SWARM MIND wrote none, and flags old coverage", async () => {
    const r = await researchReport(mind({ answer: "Here is what the swarm published on it:", sources: [work(1, "Old report", "https://explorer.imd.fun/jobs/old", day("2026-01-05"))], ai: false }), "old topic", () => NOW);
    expect(r.answer).toContain("no written answer");
    expect(r.sources).toHaveLength(1);
    expect(r.gaps.join(" ")).toContain("could not write one");
    expect(r.gaps.join(" ")).toContain("2026-01-05");
  });

  it("bounds the question and reports a busy SWARM MIND as a 503", async () => {
    await expect(researchReport(mind({}), "hi")).rejects.toMatchObject({ status: 400 });
    await expect(researchReport(mind({}), "x".repeat(501))).rejects.toBeInstanceOf(ResearchError);
    const busy = { ask: async () => { throw new Error("rate limited"); }, search: () => [] };
    await expect(researchReport(busy, RESEARCH_SAMPLE)).rejects.toMatchObject({ status: 503 });
    expect(RESEARCH_SAMPLE.length).toBeGreaterThan(10);
  });
});
