import { describe, expect, it } from "vitest";
import { impostor, screen } from "./gatekeeper.js";

const admins = [{ id: 1, first_name: "Robert", last_name: "K", username: "probert_mihai" }, { id: 2, first_name: "Night", last_name: "Captain", username: "nightcaptain" }];
const ctx = { ourAddresses: [], ourTelegram: ["t.me/getnightshift"] };

describe("the group's door", () => {
  it("turns away people dressed as the team, in any alphabet", () => {
    expect(screen({ id: 9, first_name: "NIGHTSHIFT", last_name: "Support" }, "", admins, ctx).action).toBe("decline");
    expect(screen({ id: 9, first_name: "Аdmin" }, "", admins, ctx).action).toBe("decline"); // Cyrillic А
    expect(screen({ id: 9, first_name: "Jake", username: "help_desk_247" }, "", admins, ctx).action).toBe("decline");
    expect(screen({ id: 9, first_name: "M0derator" }, "", admins, ctx).action).toBe("decline");
  });

  it("turns away copies of an admin's name or username, but never the admin", () => {
    expect(impostor({ id: 9, first_name: "Robert", last_name: "K" }, admins)).toBe("the same name as an admin");
    expect(impostor({ id: 9, first_name: "Rob", username: "probert_mihai_" }, admins)).toBe("an admin's username");
    expect(impostor({ id: 9, first_name: "Rob", username: "probert_mihal" }, admins)).toBe("an admin's username");
    expect(impostor({ id: 9, first_name: "Rob", username: "roberto_art" }, admins)).toBeNull();
    expect(impostor({ id: 9, first_name: "Rob", username: "probertmihai" }, admins)).toBe("an admin's username");
    expect(impostor({ id: 1, first_name: "Robert", last_name: "K" }, admins)).toBeNull();
  });

  it("turns away scam bios and bots, holds brand names for an admin, lets everyone else in", () => {
    expect(screen({ id: 9, first_name: "Lena" }, "DM me to claim your airdrop", admins, ctx)).toMatchObject({ action: "decline" });
    expect(screen({ id: 9, first_name: "x", is_bot: true }, "", admins, ctx).action).toBe("decline");
    expect(screen({ id: 9, first_name: "Night Shift", last_name: "Fan" }, "", admins, ctx).action).toBe("review");
    expect(screen({ id: 9, first_name: "Maria", username: "maria_eth" }, "gm, trader and frog collector", admins, ctx)).toEqual({ action: "approve", reason: "nothing suspicious" });
    expect(screen({ id: 9, first_name: "Tom" }, "This is a scam coin lol", admins, ctx).action).toBe("approve");
  });
});
