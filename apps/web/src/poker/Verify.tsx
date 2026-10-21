import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { PlayingCard } from "./Card";
import { DECK_VERSION, cardText, cleanSeed, commitOf, dealPlan, deckOrder } from "./fair";

/**
 * /games/poker/verify: rebuild any finished hand's deck in this browser, from its server seed, the
 * players' client seeds and the hand number, and check the seed against the commitment the table
 * showed before the deal. Nothing here asks the server.
 */
export function VerifyDeck() {
  const q = new URLSearchParams(location.search);
  const [seed, setSeed] = useState(q.get("serverSeed") ?? "");
  const [seeds, setSeeds] = useState(q.get("seeds") ?? "");
  const [hand, setHand] = useState(q.get("hand") ?? "1");
  const [players, setPlayers] = useState(q.get("players") ?? "2");
  const [commit, setCommit] = useState(q.get("commit") ?? "");
  const [out, setOut] = useState<{ deck: number[]; commit: string; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setErr(null);
    const s = seed.trim().toLowerCase(), h = Number(hand), n = Number(players);
    if (!/^[0-9a-f]{64}$/.test(s)) { setErr("The server seed is 64 hex characters (shown in the hand history once the match is over)."); setOut(null); return; }
    if (!Number.isInteger(h) || h < 1) { setErr("The hand number is a whole number from 1."); return; }
    if (!Number.isInteger(n) || n < 2 || n > 10) { setErr("Two to ten players were dealt in."); return; }
    try { setOut({ deck: await deckOrder(s, seeds.split(","), h), commit: await commitOf(s), n }); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (q.get("serverSeed")) void run(); }, []);
  const plan = out ? dealPlan(out.n) : null;
  const ok = out && commit.trim() ? out.commit === commit.trim().toLowerCase() : null;
  const role = (i: number) => {
    if (!plan) return "";
    const h = plan.hole.findIndex(([a, b]) => a === i || b === i);
    if (h >= 0) return h === 0 ? "1st after the button" : `${h + 1}${h === 1 ? "nd" : h === 2 ? "rd" : "th"} after the button`;
    if (plan.burns.includes(i)) return "burn";
    if (plan.flop.includes(i)) return "flop";
    return i === plan.turn ? "turn" : i === plan.river ? "river" : "";
  };
  return <main className="pk-verify">
    <section className="pk-panel">
      <span className="pk-kicker"><Icon name="shield" size={13} />PROVABLY FAIR DECK</span>
      <h1>Verify a hand</h1>
      <p>Before each hand the table shows SHA-256 of a secret server seed. Each player's browser adds a seed of its own. The deck is shuffled from both; when the match is over the server seed is revealed, and this page rebuilds the deck here, in your browser.</p>
      <form className="pk-verify-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label><span>Server seed</span><input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="64 hex characters" spellCheck={false} autoComplete="off" /></label>
        <label><span>Client seeds, by seat</span><input value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder="seat 1, seat 2, … (comma-separated)" spellCheck={false} autoComplete="off" /></label>
        <div className="pk-verify-row">
          <label><span>Hand</span><input inputMode="numeric" value={hand} onChange={(e) => setHand(e.target.value)} /></label>
          <label><span>Players dealt in</span><input inputMode="numeric" value={players} onChange={(e) => setPlayers(e.target.value)} /></label>
        </div>
        <label><span>Commitment shown before the deal</span><input value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="optional: 64 hex characters" spellCheck={false} autoComplete="off" /></label>
        <button type="submit" className="pk-btn"><Icon name="shield" size={16} />REBUILD THE DECK</button>
      </form>
      {err && <p className="pk-error" role="alert"><Icon name="alert" size={15} />{err}</p>}
    </section>
    {out && <section className="pk-panel">
      <div className={`pk-verdict ${ok === null ? "" : ok ? "ok" : "bad"}`} role="status">
        <Icon name={ok === false ? "alert" : "check"} size={18} />
        <span>{ok === null ? "Deck rebuilt. Paste the commitment to check the seed against it." : ok ? "The server seed matches the commitment shown before the deal." : "The server seed does NOT match this commitment."}</span>
      </div>
      <p className="pk-mono">SHA-256(server seed) = {out.commit}</p>
      <p className="pk-mono">client seeds used: {seeds.split(",").map((s) => cleanSeed(s) || "(none)").join(" · ")}</p>
      <ol className="pk-deck">{out.deck.map((c, i) => <li key={i} className={role(i) ? `r-${role(i).split(" ")[0]}` : ""}><span>{i + 1}</span><PlayingCard card={c} size={40} /><small>{role(i)}</small></li>)}</ol>
      <p className="pk-mono">{out.deck.map(cardText).join(" ")}</p>
    </section>}
    <section className="pk-panel pk-how">
      <h2>How the deck is made</h2>
      <ol>
        <li>Commitment: <code>SHA-256(serverSeed)</code>, the seed as its 64 hex characters.</li>
        <li>Random stream: block <i>k</i> = <code>HMAC-SHA256(key = serverSeed, "{DECK_VERSION}|hand|seed1,seed2,…|k")</code>, client seeds in seat order, an empty one for a seat that sent none; read as big-endian 32-bit numbers.</li>
        <li>Shuffle: start from 2c 2d 2h 2s 3c … As; for i from 51 down to 1, draw u until u &lt; 2<sup>32</sup> − (2<sup>32</sup> mod (i + 1)), then swap card i with card u mod (i + 1).</li>
        <li>Deal from the top: hole cards round the table twice from the seat after the button, then burn, flop, burn, turn, burn, river.</li>
      </ol>
      <p>The same check without a browser: <code>GET /api/poker/verify?serverSeed=…&amp;seeds=…&amp;hand=…&amp;players=…&amp;commit=…</code></p>
    </section>
  </main>;
}
