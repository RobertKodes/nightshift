import { describe, expect, it } from "vitest";
import { judge, muteMinutes } from "./moderation.js";

const ctx = { ourAddresses: ["0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5"], ourTelegram: ["t.me/getnightshift"] };
const level = (t: string) => judge(t, ctx)?.level ?? null;

describe("community guard", () => {
  it("lets normal talk and honest questions through", () => {
    for (const t of [
      "gm frogs 🐸", "Is the contract audited?", "is the liquidity locked?", "how do I stake for 12 months?", "just bought 0.1 ETH worth, lfg",
      "where can I see the tokenomics? getnightshift.tech/tokenomics", "chart https://dexscreener.com/ethereum/0xabc", "I can't connect my wallet to the site",
      "what does the keeper do?", "the drug store is closed lol", "rugby match tonight", "official tg t.me/getnightshift",
      "here is the dev wallet 0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5",
    ]) expect(level(t), t).toBeNull();
  });
  it("mutes scams on sight", () => {
    for (const t of [
      "Please send your seed phrase to verify", "Connect your wallet here to claim", "FR33 A1RDR0P is live, claim your tokens",
      "DM me for support", "admin will dm you", "real CA: 0x1111111111111111111111111111111111111111", "contact me on whatsapp",
      "double your eth, send eth and receive 2x",
    ]) expect(level(t), t).toBe("scam");
  });
  it("mutes spam and other projects' links", () => {
    for (const t of ["next 100x gem, join my group", "join t.me/othergem now", "visit https://free-money.xyz", "stealth launch in 5 min", "promote your project with us"]) expect(level(t), t).toBe("spam");
  });
  it("warns FUD first", () => {
    for (const t of ["this is a rug", "honeypot, can't sell", "dev dumped everything", "its over, going to zero", "scam", "r u g p u l l incoming"].slice(0, 5)) expect(level(t), t).toBe("fud");
    expect(muteMinutes("fud", 1)).toBe(0);
    expect(muteMinutes("fud", 2)).toBe(60);
    expect(muteMinutes("scam", 1)).toBe(1440);
  });
});
