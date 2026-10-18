import { RuleBar } from "./TokenomicsPage";

const GAMES: [string, string, string][] = [
  ["Frog Flip", "Two players, one coin. The flip comes from Chainlink VRF, so neither player nor NIGHTSHIFT can pick it.", "First"],
  ["Rock, Paper, Frog", "Both pick in secret (commit), then reveal. Nobody sees the other's choice before locking theirs.", "Next"],
  ["Night Dice", "Highest roll takes the pot. Rolls from Chainlink VRF, shown on chain.", "Next"],
  ["Moon Race", "A short race of reflexes. Proposed: a skill game, scored on chain from signed moves.", "Idea"],
];

/** The Game Room: announced. PvP games in $SHIFT and IMD; the page explains the rules before they exist. */
export function GameRoomPage() {
  return (
    <div className="docs token-page games-page">
      <span className="eyebrow">GAME ROOM · SPACE PINBALL IS LIVE</span>
      <h1>NIGHTSHIFT Game Room. <em>For awesome night breaks.</em></h1>
      <p className="lead">Short player-versus-player games between shifts. Two players put in the same amount of $SHIFT or IMD; the winner takes the pot, minus a 5% fee split by the one rule, so every game also burns $SHIFT and IMD.</p>

      <section className="tkn-card pb-promo" aria-labelledby="pb-promo-title">
        <div className="pb-promo-visual" aria-hidden="true"><img src="/games/pinball/key-art.webp" alt="" /></div>
        <div className="pb-promo-content">
          <div className="pb-promo-meta"><span className="pb-promo-label">NIGHTSHIFT ORIGINAL / 01</span><span className="pb-promo-status">LIVE</span></div>
          <h2 id="pb-promo-title"><img className="pb-promo-logo" src="/brand/space-pinball-logo.svg" alt="Space Pinball by NIGHTSHIFT" width={410} height={156} /></h2>
          <p>Skill duels. Same table, same seed. Free to play now.</p>
          <a className="pb-promo-play" href="/games/pinball">Play now</a>
          <small>IMD and $SHIFT stakes open with the escrow</small>
        </div>
      </section>

      <section className="tkn-card">
        <div className="tkn-head"><div><b>HOW A MATCH WORKS</b><span>Ethereum · $SHIFT or IMD · one contract holds the pot</span></div><span className="tkn-state">STAKES SOON</span></div>
        <div className="frogs-traits">
          <div><b>1</b><span>You open a match and set the amount, say 1,000 $SHIFT. It goes into the game contract, not to NIGHTSHIFT.</span></div>
          <div><b>2</b><span>Another player joins with the same amount. The pot is now 2,000 $SHIFT.</span></div>
          <div><b>3</b><span>The game is played. The result comes from Chainlink VRF or a commit and reveal, never from our server.</span></div>
          <div><b>4</b><span>The winner gets <b>1,900 $SHIFT</b>, nearly twice what they put in. The loser gets nothing. 100 $SHIFT (5%) is split by the rule.</span></div>
        </div>
        <p className="tkn-warn">Not live. There is no Game Room contract yet: any site or link offering NIGHTSHIFT games today is fake.</p>
      </section>

      <h2 className="guide-h2">The games, one at a time</h2>
      <div className="tkn-util two">{GAMES.map(([a, b, s], i) => <div key={a} className="tkn-u"><span>{String(i + 1).padStart(2, "0")} · {s.toUpperCase()}</span><b>{a}</b><p>{b}</p></div>)}</div>

      <h2 className="guide-h2">Where the 5% goes</h2>
      <p>The same rule as every NIGHTSHIFT fee. Of a 100 $SHIFT game fee: 40 to stakers and NIGHT FROGS holders, 20 to the dev wallet, 20 to the treasury, and 20 burned. In IMD games, the burned part goes to IMD's own BurnExecutor.</p>
      <RuleBar />

      <h2 className="guide-h2">Fair by design</h2>
      <ul className="frogs-util">
        <li><b>Your money never sits with us.</b> The pot is held by the game contract until the result, then paid out by it.</li>
        <li><b>No house edge beyond the fee.</b> You play another person, not NIGHTSHIFT. The 5% fee is the only cut, and it is the same in every game.</li>
        <li><b>Results you can check.</b> Random games use Chainlink VRF, like the NIGHT FROGS reveal; choice games use commit and reveal. A match that is not finished in time can be refunded to both players.</li>
        <li><b>Built by the IMD swarm.</b> Each game contract will be written, tested and audited by IMD's agents before it opens, and checked again on chain by us.</li>
      </ul>

      <section className="card"><div className="card-b docs-b">
        <h4>Play responsibly</h4>
        <p>Games where money is at stake count as gambling in many countries, Romania included. The Game Room will open only where it is allowed, for adults (18+), and may be closed to some regions. Only play with what you can afford to lose.</p>
      </div></section>
    </div>
  );
}
