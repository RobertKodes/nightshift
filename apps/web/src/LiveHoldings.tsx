import { useEffect, useState } from "react";
import { type Address, createPublicClient, erc20Abi, http } from "viem";
import { mainnet } from "viem/chains";

const rpc = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com") });
const POOL_MANAGER: Address = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
const SWARM: Address = "0x0d4dd35026087e720033786578a7e718c8b34897";
const DEV: Address = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const TREASURY: Address = "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69";

type Row = { label: string; address: Address; note: string };

/**
 * Where every $SHIFT is right now, read from Ethereum in your browser. The launch seeded 888.9M in
 * the pool, 100M to the IMD swarm and 11.1M to the dev wallet; the treasury's 81.49M were bought
 * in the first buy (0.91 ETH), like anyone else's. Nothing here is typed by hand.
 */
export function LiveHoldings({ token, contracts }: { token: string; contracts?: Record<string, string> }) {
  const rows: Row[] = [
    { label: "Uniswap v4 pool (the market)", address: POOL_MANAGER, note: "Seeded with 888.9M at launch; shrinks as people buy" },
    { label: "IMD swarm (Merkle distributor)", address: SWARM, note: "100M at launch, claimed by the agents and IMD seat holders" },
    { label: "Treasury 0x3322…4D69", address: TREASURY, note: "Bought 81.49M for 0.91 ETH in the first buy, then fees" },
    { label: "Dev wallet 0x6C4c…19b5", address: DEV, note: "11.1M at launch, then fees" },
    ...(contracts?.rewards ? [{ label: "Staking and rewards", address: contracts.rewards as Address, note: "Staked $SHIFT and rewards waiting to stream" }] : []),
    ...(contracts?.splitter ? [{ label: "Fee splitter", address: contracts.splitter as Address, note: "Sell fees not yet split" }] : []),
    { label: "Burned (0x…dEaD)", address: DEAD, note: "Gone forever" },
  ];
  const [bal, setBal] = useState<Record<string, bigint> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void Promise.all(rows.map((r) => rpc.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [r.address] }).catch(() => -1n)))
      .then((v) => { if (alive) setBal(Object.fromEntries(rows.map((r, i) => [r.address, v[i]!]))); });
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [token, contracts?.rewards, contracts?.splitter]);

  const fmt = (v?: bigint) => (v === undefined ? "…" : v < 0n ? "?" : (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 }));
  const pct = (v?: bigint) => (v === undefined || v < 0n ? "" : `${((Number(v) / 1e27) * 100).toFixed(2)}%`);
  return (
    <table className="plain addr"><thead><tr><th>Where</th><th>$SHIFT now</th><th>Share</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.address}>
        <td><a href={`https://etherscan.io/token/${token}?a=${r.address}`} target="_blank" rel="noreferrer">{r.label}</a><div className="faint" style={{ fontSize: 12 }}>{r.note}</div></td>
        <td className="mono">{fmt(bal?.[r.address])}</td><td className="mono">{pct(bal?.[r.address])}</td>
      </tr>)}
    </tbody></table>
  );
}
