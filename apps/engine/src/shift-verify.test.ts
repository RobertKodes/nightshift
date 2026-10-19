import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { dispatcherSelectors } from "./shift-verify.js";

/** A dispatcher like solc writes it: DUP1 PUSH4 <selector> EQ PUSH2 <dest> JUMPI, per function. */
const dispatcher = (sigs: string[]) => `0x6080604052${sigs.map((s) => `8063${toFunctionSelector(s).slice(2)}1461ffff57`).join("")}00`;
const ERC20 = ["name()", "symbol()", "decimals()", "totalSupply()", "balanceOf(address)", "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)", "allowance(address,address)"];

describe("the post-deploy token check", () => {
  it("reads every selector a dispatcher compares against", () => {
    expect(dispatcherSelectors(dispatcher(ERC20)).sort()).toEqual(ERC20.map((s) => toFunctionSelector(s).slice(2)).sort());
  });
  it("sees a mint under another name, which a denylist of names would miss", () => {
    const sels = dispatcherSelectors(dispatcher([...ERC20, "mintTo(address,uint256)", "setTaxes(uint256,uint256)"]));
    expect(sels).toContain("449a52f8");
    expect(sels).toContain(toFunctionSelector("setTaxes(uint256,uint256)").slice(2));
  });
  it("does not read selectors out of push data", () => {
    // PUSH32 that happens to contain DUP1 PUSH4 <mint> EQ
    const data = `8063${toFunctionSelector("mint(address,uint256)").slice(2)}14`.padEnd(64, "0");
    expect(dispatcherSelectors(`0x7f${data}00`)).toEqual([]);
  });
});
