import { Icon } from "./Icon";
import { InstallButton } from "./landing/app";
import { Link } from "./router";
import { type Game, GAME_ICON, Lounge, useLounge } from "./games/lounge";
import { WeeklyPrizes } from "./games/prizes";
import "./games/room.css";

/** Each game: its real table (captured from the game itself), what it is, where to play and practise. */
const TILES: { game: Game; name: string; line: string; img: string; w: number; h: number; practice: string; practiceLabel: string }[] = [
  { game: "chess", name: "NIGHT CHESS", line: "Real-time chess on a 3D board: blitz or rapid, rated. Practice against Frog #7.", img: "/games/tiles/chess.webp", w: 880, h: 693, practice: "/games/chess?practice=1", practiceLabel: "Practice" },
  { game: "pool", name: "NIGHT POOL", line: "8-ball on WPA rules, every shot simulated by the server. Practice against Frog #7.", img: "/games/tiles/pool.webp", w: 880, h: 518, practice: "/games/pool", practiceLabel: "Practice" },
  { game: "poker", name: "NIGHT POKER", line: "Heads-up No-Limit Hold'em on a provably fair deck, rated or staked. Practice against Frog #7.", img: "/games/tiles/poker.webp", w: 880, h: 550, practice: "/games/poker?practice=1", practiceLabel: "Practice" },
  { game: "pinball", name: "SPACE PINBALL", line: "Duels on the same table and seed, scores verified by replay. Practice solo.", img: "/games/tiles/pinball.webp", w: 640, h: 693, practice: "/games/pinball?practice=1", practiceLabel: "Practice" },
];

/** The Game Room: the four games, the lounge, and how a staked game works, in plain words. */
export function GameRoomPage() {
  const l = useLounge();
  const live = (g: Game) => l?.live.filter((x) => x.game === g && !x.house).length ?? 0;
  const house = (g: Game) => l?.live.filter((x) => x.game === g && x.house).length ?? 0;
  const waiting = (g: Game) => (l ? g === "chess" ? Object.values(l.waiting.chess).reduce((a, b) => a + b, 0) : g === "pool" ? l.waiting.pool ?? 0 : g === "poker" ? l.waiting.poker ?? 0 : l.waiting.pinball : 0);
  return (
    <div className="gr">
      <header className="gr-head">
        <div>
          <h1>Game Room</h1>
          <p>Chess, pool, poker and pinball against real people, here or in the app. Play free, or put the same amount of $SHIFT or IMD in; winner gets 95%.</p>
        </div>
        <div className="gr-head-actions"><Link to="/games/live" className="gr-btn ghost"><Icon name="radar" size={16} />Watch live</Link><InstallButton /></div>
      </header>

      <div className="gr-tiles">
        {TILES.map((t) => (
          <article key={t.game} className={`gr-tile gr-${t.game}`}>
            <Link to={`/games/${t.game}`} className="gr-art" aria-label={`Play ${t.name}`}><img src={t.img} alt="" width={t.w} height={t.h} loading="lazy" decoding="async" /></Link>
            <div className="gr-body">
              <h2><Icon name={GAME_ICON[t.game]} size={18} />{t.name}</h2>
              <p>{t.line}</p>
              <span className="gr-now">{l === null ? "…" : `${waiting(t.game)} waiting · ${live(t.game)} playing now${house(t.game) ? " · house exhibition on" : ""}`}</span>
              <div className="gr-actions">
                <Link to={`/games/${t.game}`} className="gr-btn primary"><Icon name="swords" size={16} />Play now</Link>
                <Link to={t.practice} className="gr-btn ghost">{t.practiceLabel}</Link>
              </div>
            </div>
          </article>
        ))}
      </div>

      <Lounge create />

      <WeeklyPrizes />

      <section className="gr-card" aria-labelledby="gr-stake">
        <h2 id="gr-stake">Playing for a stake</h2>
        <ol className="gr-steps">
          <li><b>Open a challenge.</b> Pick the game and the amount, say 100,000 $SHIFT. One confirmation in your wallet puts it in the GameEscrow contract, not with NIGHTSHIFT.</li>
          <li><b>A rival joins</b> with the same amount. Both of you get a "Take your seat" banner on any page; the clock starts once you are both at the table.</li>
          <li><b>You play.</b> The server runs the game, checks every move or shot, and signs the result.</li>
          <li><b>The contract pays.</b> The winner gets 95% of the pot, paid by the contract; a draw, or a game one of you never got to play, refunds both. If the payout is slow, you can send the signed result from your own wallet.</li>
        </ol>
        <p className="gr-fine">The 5% fee goes to $SHIFT stakers and NIGHT FROGS holders, the team, the treasury and burns. Contract <a href="https://etherscan.io/address/0xf460fd9ad76f18414f54a2431870e8a116193489" target="_blank" rel="noreferrer">0xf460…3489 ↗</a>.</p>
      </section>

      <section className="gr-card" aria-labelledby="gr-fair">
        <h2 id="gr-fair">Fair play</h2>
        <ul className="gr-fair">
          <li><b>Your stake stays in the contract</b> until the result: nobody at NIGHTSHIFT can move it, only pay it to one of the two players or back to both.</li>
          <li><b>A dropped phone is not a lost game.</b> In a staked game you have 2 minutes in all to come back on your turn, and your rival sees the countdown.</li>
          <li><b>You play people.</b> No house edge: the fee is the only cut, the same in every game.</li>
        </ul>
        <p className="gr-legal"><Icon name="lock" size={14} />Free games need no wallet. Staked games: 18+, only where allowed.</p>
      </section>

      <Link to="/arena" className="gr-arena"><Icon name="swords" size={18} /><span><b>Agent Arena</b>AI agents play NIGHT CHESS against each other and against you.</span><Icon name="arrow" size={16} /></Link>
    </div>
  );
}
