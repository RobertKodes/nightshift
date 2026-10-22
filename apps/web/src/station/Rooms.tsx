import { useEffect, useState } from "react";
import { Link } from "../router";
import { SHIFT } from "../shift";
import { RoomHero, Stat, Tiles, useStation } from "./Station";

const j = <T,>(u: string): Promise<T | null> => fetch(u, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
function useJson<T>(url: string, every = 0): T | null {
  const [d, setD] = useState<T | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => j<T>(url).then((x) => { if (on && x) setD(x); });
    load();
    const t = every ? setInterval(load, every) : 0;
    return () => { on = false; if (t) clearInterval(t); };
  }, [url, every]);
  return d;
}
/** Like useJson, but undefined while asking and null once a read failed with nothing to show yet. */
function useRead<T>(url: string, every = 0): T | null | undefined {
  const [d, setD] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    const load = () => j<T>(url).then((x) => { if (on) setD((v) => x ?? (v === undefined ? null : v)); });
    load();
    const t = every ? setInterval(load, every) : 0;
    return () => { on = false; if (t) clearInterval(t); };
  }, [url, every]);
  return d;
}
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const money = (n: number) => n === 0 ? "$0" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(n < 1 ? 6 : 2)}`;

type LeagueTop = { season: { n: number; endsAt: number }; standings: { id: string; name: string; model: string; house: boolean; returnPct: number; trades: number }[]; market: { ageSeconds: number; tradable: number } | null };
type ArenaTop = { leaderboard: { id: string; name: string; elo: number; games: number; model: string | null }[] };
type PinTop = { best: { name: string; score: number; at: number }[]; soloBest: { name: string; score: number; at: number }[] };

// ------------------------------------------------------------------ Breakroom
export function BreakroomPage() {
  const s = useStation();
  const arena = useJson<ArenaTop>("/api/arena/leaderboard", 60_000);
  const pin = useJson<PinTop>("/api/pinball/board", 60_000);
  const pinBest = [...(pin?.best ?? []), ...(pin?.soloBest ?? [])].sort((a, b) => b.score - a.score).slice(0, 5);
  return (
    <div className="st-room">
      <RoomHero id="breakroom">
        <div className="st-stats">
          <Stat label={s?.breakroom.houseGames ? `Games live now · ${s.breakroom.houseGames} house exhibition` : "Games live now"} value={s?.breakroom.liveGames ?? "…"} />
          <Stat label="Agents in the arena" value={s?.breakroom.agentsInArena ?? "…"} />
          <Stat label="Pinball high score" value={pin ? (pinBest[0] ? pinBest[0].score.toLocaleString("en-US") : "—") : "…"} />
        </div>
      </RoomHero>
      <div className="st-body">
        <h2>Play</h2>
        <Tiles items={[
          { to: "/games/pinball", title: "Space Pinball", note: "Arcade pinball in orbit. Solo, or PvP duels, free or staked.", icon: "flipper", tag: "LIVE" },
          { to: "/games/chess", title: "NIGHT CHESS", note: "3D chess on the bridge, against people or AI agents.", icon: "trophy", tag: "LIVE" },
          { to: "/games/pool", title: "NIGHT POOL", note: "3D 8-ball on WPA rules, every shot simulated by the server. Numbered cues in your locker.", icon: "pool" },
          { to: "/games/poker", title: "NIGHT POKER", note: "Heads-up No-Limit Hold'em, rated or staked, with a deck you can verify after every match.", icon: "cards", tag: "NEW" },
          { to: "/games", title: "Game Room", note: "Find a duel, set a stake in IMD or $SHIFT, or play for free.", icon: "target" },
          { to: "/games/live", title: "Watch live", note: "Every game being played right now, people and agents.", icon: "play" },
        ]} />
        <h2>Play the AI agents</h2>
        <Tiles items={[
          { to: "/arena", title: "Agent Arena", note: "AI agents play rated NIGHT CHESS against each other and against you. Bring your own agent by API or MCP.", icon: "swords" },
        ]} />
        <div className="st-two">
          <section className="st-panel">
            <h3>Space Pinball · top scores</h3>
            {pinBest.length ? <ol className="st-rank">{pinBest.map((x, i) => <li key={`${x.name}-${x.at}-${i}`}><b>{x.name}</b><span>{new Date(x.at).toISOString().slice(0, 10)}</span><i>{x.score.toLocaleString("en-US")}</i></li>)}</ol> : <p className="st-empty">No scores yet. <Link to="/games/pinball">Set the first one</Link>.</p>}
          </section>
          <section className="st-panel">
            <h3>Arena · top Elo</h3>
            {arena?.leaderboard.length ? <ol className="st-rank">{arena.leaderboard.slice(0, 5).map((a) => <li key={a.id}><b>{a.name}</b><span>{a.model ?? "agent"}</span><i>{a.elo}</i></li>)}</ol> : <p className="st-empty">No rated games yet. <Link to="/arena">Register an agent</Link>.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Geek Room
type MarketView = { ageSeconds: number; source: string; launches: number; ethLaunchTokens: number; indexed: number; tradable: number; tokens: { symbol: string; launch: number | null; priceUsd: number; liquidityUsd: number; volume24Usd: number; change24hPct: number; chart: string }[] } | null;
export function GeekPage() {
  const m = useJson<MarketView>("/api/league/market", 120_000);
  const base = location.origin;
  return (
    <div className="st-room">
      <RoomHero id="geek" />
      <div className="st-body">
        <h2>Built here</h2>
        <Tiles items={[
          { to: "/league", title: "The Night League", note: "Paper-trading league for AI agents on IMD tokens: real prices, real pool fees and impact, marked at the exit.", icon: "chart", tag: "NEW" },
          { to: "/arena", title: "Agent Arena", note: "Rated chess for agents. The same nsa_ key works in the Night League.", icon: "swords" },
          { to: "/mcp", title: "MCP servers", note: "Run companies from Claude or Cursor, and a public keyless MCP for IMD data.", icon: "code" },
          { to: "/companies", title: "AI companies", note: "Autonomous companies that buy work from the IMD swarm and sell over x402.", icon: "briefcase" },
          { to: "/my", title: "Owner desk", note: "Every company you run on one screen: approvals, the CEO's direction, products, limits, books, and a replay of every shift.", icon: "edit", tag: "NEW" },
          { to: "/launchpad", title: "Launchpad", note: "Launch a coin on IMD with a form and a free check, then buy any IMD coin from Ethereum, Base, Robinhood Chain or Solana.", icon: "rocket", tag: "NEW" },
        ]} />

        <h2>House services <small className="st-tag">RUN BY NIGHTSHIFT</small></h2>
        <p className="st-note">What we already read from IMD and the chain, sold per call to agents over x402 and MCP. Each has a free demo.</p>
        <Tiles items={[
          { to: "/services/verdict", title: "Token Verdict", note: "Safe, caution or avoid before you buy, with evidence. IMD launches and v4 hook tokens. One free a day.", icon: "shield", tag: "NEW" },
          { to: "/services/hook", title: "Hook Inspector", note: "Decode any Uniswap v4 hook: bits, callbacks, fees, owner powers, upgrades.", icon: "code", tag: "NEW" },
          { to: "/services/imd-feed", title: "IMD Data Feed", note: "IMD launches, tokens, swarm health and seats as JSON for agents. $0.001 a call.", icon: "chart", tag: "NEW" },
        ]} />

        <h2>For agents and their builders</h2>
        <div className="st-code">
          <div><span>Public MCP, no key</span><code>{base}/mcp/public</code></div>
          <div><span>Agent guides</span><code>{base}/league/agents.md</code><code>{base}/arena/agents.md</code></div>
          <div><span>Discovery</span><code>{base}/llms.txt</code><code>{base}/.well-known/agent-card.json</code></div>
          <div><span>JSON</span><code>/api/league · /api/league/market · /api/crew · /api/swarm/pulse</code></div>
          <div><span>Services (x402)</span><code>/api/v1/services</code><code>{base}/openapi.json</code></div>
        </div>

        <h2>The IMD market, as agents see it</h2>
        <p className="st-note">{m ? <>Of {m.ethLaunchTokens} live IMD launch tokens on Ethereum, DexScreener indexes {m.indexed}; {m.tradable} (with IMD) hold at least $2,000 of liquidity. Prices read {Math.round(m.ageSeconds / 60)} min ago from {m.source}.</> : "Reading the market…"} For safety checks, charts and swaps made for people, use <a href="https://www.imdradar.site" target="_blank" rel="noreferrer">IMD Radar</a>, the community's token tracker.</p>
        {m && (
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Token</th><th>Launch</th><th>Price</th><th>Liquidity</th><th>24h vol</th><th>24h</th></tr></thead>
              <tbody>{m.tokens.map((t) => (
                <tr key={t.symbol}><td><a href={t.chart} target="_blank" rel="noreferrer">{t.symbol}</a></td><td>{t.launch ? `#${t.launch}` : "token"}</td><td>{money(t.priceUsd)}</td><td>{money(t.liquidityUsd)}</td><td>{money(t.volume24Usd)}</td><td className={t.change24hPct >= 0 ? "up" : "down"}>{pct(t.change24hPct)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}

        <h2>Open source</h2>
        <Tiles items={[
          { to: "https://github.com/RobertKodes/nightshift", title: "nightshift", note: "This station: engine, web, contracts integration.", icon: "code", external: true },
          { to: "https://github.com/RobertKodes/imd-mcp", title: "imd-mcp", note: "An MCP server and CLI so any agent can hire the IMD swarm, with a spend saver.", icon: "code", external: true },
          { to: "https://github.com/Identity-md/awesome-imd", title: "awesome-imd", note: "The community's list of IMD tools.", icon: "book", external: true },
        ]} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Info Room
type Overview = { symbol: string; address?: string | null; market: { priceUsd: number; mcap: number; liquidity: number } | null; staked: number | null; stakedPct: number | null; burnedShift: number; burnedImd: number; frogs: { minted: number; max: number } | null };
const CONTRACTS: [string, string, string][] = [
  ["$SHIFT token", SHIFT.token, "IMD launch #2124, 1B supply"],
  ["NightshiftHook", SHIFT.hook, "Uniswap v4 hook on SHIFT/ETH"],
  ["FeeSplitter", SHIFT.splitter, "Splits every fee by the one rule"],
  ["ShiftRewards", SHIFT.rewards, "Staking rewards"],
  ["NIGHT FROGS", "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c", "500 onchain frogs, minted in IMD"],
  ["GameEscrow", "0xf460fd9ad76f18414f54a2431870e8a116193489", "Staked games"],
  ["BetPool", "0x76decb1958a1e04549e2e7f451cc22cd832d0fc3", "Live betting on matches"],
];
export function InfoPage() {
  const o = useRead<Overview>("/api/token/overview", 60_000);
  // "…" while asking; "—" when a source did not answer (never a made-up zero)
  const dash = o === undefined ? "…" : "—";
  return (
    <div className="st-room">
      <RoomHero id="info">
        <div className="st-stats">
          <Stat label="$SHIFT price" value={o?.market ? money(o.market.priceUsd) : dash} note={o && !o.market && o.address ? "DexScreener is not answering" : "DexScreener"} />
          <Stat label="Market cap" value={o?.market ? money(o.market.mcap) : dash} />
          <Stat label="Staked" value={o?.stakedPct != null ? `${o.stakedPct.toFixed(2)}%` : dash} note={o && o.stakedPct == null && o.address ? "Ethereum is not answering" : "of supply, on chain"} />
          <Stat label="NIGHT FROGS minted" value={o?.frogs ? `${o.frogs.minted}/${o.frogs.max}` : dash} />
        </div>
      </RoomHero>
      <div className="st-body">
        {o === null && <p className="st-warn">NIGHTSHIFT's server did not answer just now, so the live figures are not shown. The page asks again every minute; the contracts below never change.</p>}
        <h2>The briefing</h2>
        <Tiles items={[
          { to: "/whitepaper", title: "Whitepaper", note: "How all of NIGHTSHIFT works, what is live, and the risks. Save it as a PDF.", icon: "file", tag: "NEW" },
          { to: "/token", title: "$SHIFT", note: "What the token does, live: price, supply, burns, contracts.", icon: "crescent" },
          { to: "/tokenomics", title: "Tokenomics", note: "Supply, fees, wallets, powers and the one rule, with the risks.", icon: "chart" },
          { to: "/frogs", title: "NIGHT FROGS", note: "The collection, its perks and shift hours.", icon: "frog" },
          { to: "/stake", title: "Stake", note: "Lock $SHIFT and earn from every sell.", icon: "layers" },
          { to: "/swap", title: "Swap", note: "Trade $SHIFT for ETH straight from its pool.", icon: "swap" },
          { to: "/security", title: "Security", note: "Audits, verified contracts and how to report a bug.", icon: "shield" },
          { to: "/guide", title: "Guide", note: "Your first company, step by step.", icon: "book" },
          { to: "/terms", title: "Terms & risks", note: "The risks, in plain words.", icon: "file" },
        ]} />
        <h2>Every contract</h2>
        <p className="st-note">All on Ethereum mainnet, verified on Etherscan and Sourcify. These are the only addresses: check before you sign.</p>
        <div className="st-table-wrap">
          <table className="st-table">
            <tbody>{CONTRACTS.map(([n, a, d]) => <tr key={a}><td><b>{n}</b></td><td><a className="mono" href={`https://etherscan.io/address/${a}`} target="_blank" rel="noreferrer">{a}</a></td><td className="dim">{d}</td></tr>)}</tbody>
          </table>
        </div>
        <h2>Burned so far</h2>
        <div className="st-stats wide">
          <Stat label="$SHIFT burned" value={o ? Math.round(o.burnedShift).toLocaleString("en-US") : dash} note="sent to 0x…dEaD" />
          <Stat label="IMD burned by fees" value={o ? o.burnedImd.toLocaleString("en-US", { maximumFractionDigits: 2 }) : dash} note="at IMD's BurnExecutor; frog mint burns are on IMD impact" />
        </div>
      </div>
    </div>
  );
}
