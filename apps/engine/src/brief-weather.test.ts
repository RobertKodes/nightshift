import { describe, expect, it } from "vitest";
import { diagnose, kindOf, readCheck } from "./brief-doctor.js";
import { workOf } from "./swarm-mind.js";
import { forecast, skyOf, topicsOf, weatherText } from "./swarm-weather.js";

const missing = { kind: "website", plan: [{ title: "Build and check the website" }], facts: [{ id: "site_pages", label: "What the site shows", state: "missing", assumed: "The builders will guess." }, { id: "x", label: "Token name", state: "not_applicable" }], blockers: [], suggestions: [{ detail: "Not said: what the site shows." }] };
const full = { kind: "website", plan: [{ title: "Build and check the website" }], facts: [{ id: "site_pages", label: "What the site shows", state: "stated" }], blockers: [], suggestions: [] };

describe("BRIEF DOCTOR", () => {
  it("reads what kind of job a request is", () => {
    expect(kindOf("Audit my vault for reentrancy")).toBe("audit");
    expect(kindOf("Draw a logo for $FROG")).toBe("logo");
    expect(kindOf("make me a landing page")).toBe("website");
    expect(kindOf("Which L2 has the lowest fees")).toBe("research");
  });

  it("reads IMD's check into plain lines, without the facts that do not apply", () => {
    expect(readCheck(missing)).toEqual({ kind: "website", plan: ["Build and check the website"], facts: [missing.facts[0]], blockers: [], suggestions: ["Not said: what the site shows."] });
  });

  it("writes a better request for what IMD would guess, and checks it again", async () => {
    const sent: unknown[] = [];
    const check = async (b: { input: { objective: string } }) => { sent.push(b); return b.input.objective.includes("home page") ? full : missing; };
    const llm = { chat: async () => ({ message: { role: "assistant", content: "REQUEST:\nA site for my frog NFTs: a home page with the collection, and a mint page.\nQUESTIONS:\n- How many frogs are in the collection?" } }) as never };
    const d = await diagnose("make me a website for my frog nft project", null, { check: check as never, mind: null, llm, model: "free" });
    expect(sent[0]).toEqual({ action: "job.open", input: { objective: "make me a website for my frog nft project", skill: "build-website" } });
    expect(d.improved).toBe("A site for my frog NFTs: a home page with the collection, and a mint page.");
    expect(d.questions).toEqual(["How many frogs are in the collection?"]);
    expect(d.after?.facts.every((f) => f.state === "stated")).toBe(true);
  });

  it("leaves a request alone when IMD finds nothing missing", async () => {
    const d = await diagnose("A home page and a mint page for my frogs", "website", { check: async () => full, mind: null, llm: { chat: async () => { throw new Error("not asked"); } }, model: "free" });
    expect(d.improved).toBeNull();
  });
});

describe("SWARM WEATHER", () => {
  it("tells the day's sky from the swarm's own week", () => {
    expect(skyOf(140, [70, 75, 80])).toBe("storm");
    expect(skyOf(85, [70, 75, 80])).toBe("sunny");
    expect(skyOf(70, [70, 75, 80])).toBe("steady");
    expect(skyOf(30, [70, 75, 80])).toBe("quiet");
  });

  it("finds the day's topics and its standout audit", () => {
    const at = new Date().toISOString();
    const today = [
      workOf({ id: "job:a", title: "Audit the Vault contract", types: ["audits"], audits: [{ jobId: "a", findings: 9 }], publishedAt: at })!,
      workOf({ id: "job:b", title: "Uniswap v4 hook for fair launches", types: ["contracts"], publishedAt: at })!,
      workOf({ id: "job:c", title: "A v4 hook that burns fees", types: ["contracts"], publishedAt: at })!,
    ];
    expect(topicsOf(today)).toEqual(["hook"]);
    const w = forecast({ agentsOnline: 1038, acceptedLastDay: 1035, jobsDoneLastDay: 140, oraclesDoneLastDay: 16, inferenceTokens: 1, launchesLive: 819, jobs: 15001 }, today, [{ day: "2026-10-22", jobs: 70 }, { day: "2026-10-23", jobs: 80 }], "2026-10-24");
    expect(w).toMatchObject({ sky: "storm", week: 75, works: 3, audit: { findings: 9 } });
    const t = weatherText(w, "https://getnightshift.tech/mind");
    expect(t).toContain("⛈ <b>SWARM WEATHER · 2026-10-24</b>");
    expect(t).toContain("140 jobs done (a usual day: 75)");
    expect(t).toContain("🔥 Hot today: #hook");
  });
});
