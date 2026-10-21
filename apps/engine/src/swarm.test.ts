import { describe, expect, it } from "vitest";
import { marks, reached } from "./swarm.js";

const node = (key: string, state: string) => ({ key, state });
describe("the Night Watchers build updates", () => {
  it("counts a step only when every node of it is accepted, and deployed only once the launch is live", () => {
    const building = [node("build_contract_project", "working"), node("write_foundry_tests", "waiting"), node("audit_math", "waiting"), node("audit_judge", "waiting")];
    expect(reached(building)).toEqual([]);
    expect(marks(building)).toBe("🔨 contracts · ⏳ tests · ⏳ audit · ⏳ deploy");
    const testing = [node("build_contract_project", "accepted"), node("write_foundry_tests", "working"), node("audit_math", "accepted"), node("audit_judge", "waiting")];
    expect(reached(testing)).toEqual(["built"]);
    expect(marks(testing)).toBe("✅ contracts · 🔨 tests · ⏳ audit · ⏳ deploy");
    const audited = testing.map((n) => ({ ...n, state: "accepted" }));
    expect(reached(audited)).toEqual(["built", "tested", "audited"]);
    expect(marks(audited)).toBe("✅ contracts · ✅ tests · ✅ audit · 🔨 deploying");
    expect(reached(audited, { status: "live", id: "x" })).toEqual(["built", "tested", "audited", "deployed"]);
  });
});
