import { describe, expect, it } from "vitest";
import { relevance, worthAsking } from "./assistant.js";

describe("community assistant gate", () => {
  it("answers real questions about the project, typos included", () => {
    for (const t of [
      "what's the CA?", "how does staking work?", "is there a sell tax on shift?", "who burns the IMD?", "when do frog holders get rewards?",
      "can i lock my tokens for a year", "i cant find the stakin page", "where do I buy nightshif token", "is the contract audited?",
      "how do I start a company here?", "does the keeper run every day?", "my claim on the frogs page is not working",
    ]) expect(worthAsking(t, false), `${t} ${JSON.stringify(relevance(t))}`).toBe(true);
  });
  it("stays quiet on everything else", () => {
    for (const t of [
      "gm frens", "wen lambo?", "what do you think about pepe coin?", "lol this chart", "anyone watching the game tonight?",
      "is the price up?", "good night everyone", "I love this community", "what time is it in London?", "how are you all doing?",
    ]) expect(worthAsking(t, false), `${t} ${JSON.stringify(relevance(t))}`).toBe(false);
  });
  it("always answers when asked to the bot directly", () => {
    expect(worthAsking("hey, tell me more", true)).toBe(true);
  });
});
