import { describe, expect, it } from "vitest";
import { Index, type Work, createMind, passage, words, workOf } from "./swarm-mind.js";

const pub = (id: string, title: string, types: string[], extra: Record<string, unknown> = {}) => ({ id: `job:${id}`, title, types, publishedAt: "2026-10-24T10:00:00Z", research: types.includes("research") ? [{ jobId: id }] : [], audits: types.includes("audits") ? [{ jobId: id, findings: 3 }] : [], ...extra });

describe("SWARM MIND", () => {
  it("keeps a publication as a work: its kinds, its request, its explorer link", () => {
    const w = workOf(pub("a1", "Audit the Vault contract\n\nCheck reentrancy and rounding.", ["audits"]))!;
    expect(w).toMatchObject({ jobId: "a1", kinds: ["audits"], title: "Audit the Vault contract", url: "https://explorer.imd.fun/jobs/a1", findings: 3 });
    expect(workOf({ id: "launch:b2", title: "A custom token: Frog (FRG).", types: ["contracts"] })!.url).toBe("https://explorer.imd.fun/launches/b2");
    expect(words("Is $IMD's POOL4 burning 85%? 0xd34a99bc0f67")).toEqual(["imd", "pool4", "burn", "85", "0xd34a99bc0f67"]);
    expect(words("CappedBurnHook burns")).toEqual(["capp", "burn", "hook", "burn"]);
  });

  it("finds the works a question is about, and the passage that answers it", () => {
    const works = [workOf(pub("1", "Uniswap v4 hook for fair launches", ["contracts"]))!, workOf(pub("2", "Audit of a lending vault", ["audits"]))!, workOf(pub("3", "Research: IMD tokenomics and the POOL4 burn", ["research"]))!];
    works[2]!.text = `${"Intro text. ".repeat(80)}The CappedBurnHook burns 85 of every 100 IMD above the cap.${" More text.".repeat(80)}`;
    const ix = new Index(works);
    expect(ix.search("how much IMD does POOL4 burn")[0]!.work.jobId).toBe("3");
    expect(ix.search("v4 hook")[0]!.work.jobId).toBe("1");
    expect(passage(works[2]!, "how much does the burn hook burn")).toContain("burns 85 of every 100 IMD");
  });

  it("reads the history page by page and the reports, then answers only from them, with sources", async () => {
    const pages: Record<number, unknown> = {
      1: { count: 3, totalPages: 2, items: [pub("r1", "Research: night shift sleep science", ["research"]), pub("c1", "A custom token: Moon (MOON).", ["contracts"])] },
      2: { count: 3, totalPages: 2, items: [pub("a1", "Audit the Vault contract", ["audits"])] },
    };
    const get = async (u: string) => {
      const page = /page=(\d+)/.exec(u);
      if (page) return pages[Number(page[1])] ?? { items: [] };
      if (u.includes("/jobs/r1/result")) return { files: [{ mediaType: "text/markdown", url: "https://api.imd.fun/artifacts/r1", bytes: 100 }] };
      return { files: [] };
    };
    const text = async (u: string) => (u.endsWith("/r1") ? "# Report\n\nNight workers sleep **better** with blackout curtains." : null);
    const m = createMind({ get, text, dir: null });
    await m.tick(2, 4);
    expect(m.stats()).toMatchObject({ works: 3, reports: 1, backfilled: true });
    let sent = "";
    const llm = { chat: async (r: { messages: { content: string | null }[] }) => { sent = r.messages[1]!.content ?? ""; return { message: { role: "assistant", content: "Blackout curtains help [1]." }, servedModel: "free" } as never; } };
    const a = await m.ask("how do night workers sleep better", llm as never, "free");
    expect(sent).toContain("blackout curtains");
    expect(a.answer).toBe("Blackout curtains help [1].");
    expect(a.sources[0]).toMatchObject({ n: 1, title: "Research: night shift sleep science", url: "https://explorer.imd.fun/jobs/r1" });
    expect((await m.ask("zzzz qqqq", llm as never, "free")).sources).toEqual([]);
    // every asker shares one model budget; past it the sources still come back, without a model answer
    let calls = 0;
    const counted = { chat: async (r: never) => { calls++; return llm.chat(r); } };
    const answers = [];
    for (let i = 0; i < 61; i++) answers.push(await m.ask(`night workers sleep curtains${"x".repeat(i + 1)}`, counted as never, "free"));
    expect(calls).toBe(59);
    expect(answers.at(-1)).toMatchObject({ model: null, sources: [{ n: 1 }] });
  });
});

describe("SWARM MIND titles", () => {
  it("names an audit by the code it audited, and drops Markdown marks", () => {
    expect(workOf({ id: "job:x", title: "Scope is the v3/ folder only.", types: ["audits"], audits: [{ jobId: "x", repoUrl: "https://github.com/DrTatum/MSFT95.git", findings: 10 }] })!.title).toBe("Audit of DrTatum/MSFT95");
    expect(workOf({ id: "job:y", title: "# MASTER MISSION — build it", types: ["sites"] })!.title).toBe("MASTER MISSION — build it");
  });
});
