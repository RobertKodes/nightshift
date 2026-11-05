import { Fragment } from "react";
import { HowThisConnects } from "./HowThisConnects";
import { Icon } from "./Icon";
import { InstallButton } from "./landing/app";
import { Link } from "./router";
import { type Game, GAME_ICON, Lounge, useLounge } from "./games/lounge";
import { WeeklyPrizes } from "./games/prizes";
import ElectricBorder from "./rb/ElectricBorder";
import PixelCard from "./rb/PixelCard";
import SplitFlapText from "./rb/SplitFlapText";
import { PxHero, PxPanel } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";
import "./saas/pages/arcade.css";

/** Each game: its real table (captured from the game itself), what it is, where to play and practise. */
const TILES: { game: Game; name: string; line: string; img: string; w: number; h: number; practice: string; practiceLabel: string }[] = [
  { game: "chess", name: "NIGHT CHESS", line: "Real-time chess on a 3D board: blitz or rapid, rated. Practice against Frog #7.", img: "/games/tiles/chess.webp", w: 880, h: 693, practice: "/games/chess?practice=1", practiceLabel: "Practice" },
  { game: "pool", name: "NIGHT POOL", line: "8-ball on WPA rules, every shot simulated by the server. Practice against Frog #7.", img: "/games/tiles/pool.webp", w: 880, h: 518, practice: "/games/pool", practiceLabel: "Practice" },
  { game: "poker", name: "NIGHT POKER", line: "Heads-up No-Limit Hold'em. Practice with free chips against Frog #7; token stakes are optional.", img: "/games/tiles/poker.webp", w: 880, h: 550, practice: "/games/poker?practice=1", practiceLabel: "Practice" },
  { game: "pinball", name: "SPACE PINBALL", line: "Duels on the same table and seed, scores verified by replay. Practice solo.", img: "/games/tiles/pinball.webp", w: 640, h: 693, practice: "/games/pinball?practice=1", practiceLabel: "Practice" },
];

const two = (n: number | null) => (n === null ? "--" : String(Math.min(n, 99)).padStart(2, "0"));

/** The Game Room: the four games as arcade cabinets, the lounge, and how a staked game works, in plain words. */
export function GameRoomPage() {
  const l = useLounge();
  const rich = useRich();
  const live = (g: Game) => l?.live.filter((x) => x.game === g && !x.house).length ?? 0;
  const house = (g: Game) => l?.live.filter((x) => x.game === g && x.house).length ?? 0;
  const waiting = (g: Game) => (l ? g === "chess" ? Object.values(l.waiting.chess).reduce((a, b) => a + b, 0) : g === "pool" ? l.waiting.pool ?? 0 : g === "poker" ? l.waiting.poker ?? 0 : l.waiting.pinball : 0);
  const playing = l ? TILES.reduce((n, t) => n + live(t.game), 0) : null;
  const queued = l ? TILES.reduce((n, t) => n + waiting(t.game), 0) : null;
  // the one cabinet with real players at it gets the live border: the page's one WebGL context, wide screens only
  const hot = TILES.map((t) => t.game).filter((g) => live(g) > 0).sort((a, b) => live(b) - live(a))[0];
  return (
    <div className="lx gx">
      <PxHero
        kicker="GAME ROOM · FREE PLAY"
        title="Play"
        accent="free games."
        live
        lead="Start pinball, chess, pool or poker for free. No wallet needed. Stakes are a separate choice after you choose a game."
        actions={<>
          <Link to="/games/live" className="px-btn"><PxIcon name="pulse" size={14} />Watch games</Link>
          <Link to="/arena" className="px-btn ghost"><PxIcon name="bot" size={14} />AI / Arena</Link>
          <InstallButton />
        </>}
        aside={
          <aside className="gx-marquee" aria-label="The game room right now">
            <img className="gx-sticker" src="/brand/pepe-sticker.png" alt="" width={96} height={96} aria-hidden="true" />
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>NIGHT ARCADE · 4 CABINETS</b>
              <span className="px-term-state"><i />{l === null ? "CONNECTING" : "ONLINE"}</span>
            </div>
            <div className="gx-marquee-b">
              <div className="lx-board">
                <span>CREDITS</span>
                <SplitFlapText text="FREE PLAY" padTo={9} charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ " tileColor="#0d1410" textColor="#b8ff3d" fontSize={22} gap={3} tileRadius={2} flipDuration={0.2} stagger={0.022} intro={false} />
              </div>
              <div className="gx-nums">
                <div className="lx-board"><span>PLAYING NOW</span><SplitFlapText text={two(playing)} padTo={2} charset="0123456789-" tileColor="#0d1410" textColor="#e9f4ea" fontSize={20} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.02} intro={false} /></div>
                <div className="lx-board"><span>WAITING</span><SplitFlapText text={two(queued)} padTo={2} charset="0123456789-" tileColor="#0d1410" textColor="#e9f4ea" fontSize={20} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.02} intro={false} /></div>
              </div>
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>insert coin</span><span className="gx-nocoin">NOT NEEDED</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />

      <section className="lx-sec" aria-labelledby="gx-cabs-h">
        <div className="lx-sec-head">
          <div><span className="px-kicker">THE CABINETS</span><h2 className="px-h2" id="gx-cabs-h">Four games. Free to play.</h2><p className="px-sub">Play now, or practise first. A wallet comes in only when you choose a stake.</p></div>
        </div>
        <div className="gx-cabs">
          {TILES.map((t, i) => {
            const cab = (
              <PixelCard className={`gx-cab gx-${t.game}`} colors={["#b8ff3d", "#57d97b", "#1f6b3a"]} gap={8} speed={28} pixelSize={2} trigger="hover" radius={2} glow={0.25} spotlight={0.25} intro={false} noFocus theme="dark">
                <article className="gx-cab-in">
                  <header className="gx-cab-top">
                    <span className="gx-cab-n">0{i + 1}</span>
                    <h2><Icon name={GAME_ICON[t.game]} size={16} />{t.name}</h2>
                    {live(t.game) > 0 && <span className="gx-live"><i />LIVE</span>}
                  </header>
                  <Link to={`/games/${t.game}`} className="gx-screen" aria-label={`Play ${t.name}`}>
                    <img src={t.img} alt="" width={t.w} height={t.h} loading="lazy" decoding="async" />
                    <span className="gx-press" aria-hidden="true">PRESS START</span>
                  </Link>
                  <div className="gx-cab-b">
                    <p>{t.line}</p>
                    <span className="gx-now">{l === null ? "…" : `${waiting(t.game)} waiting · ${live(t.game)} playing now${house(t.game) ? " · house exhibition on" : ""}`}</span>
                    <div className="gx-cab-act">
                      <Link to={`/games/${t.game}`} className="px-btn primary"><Icon name="swords" size={15} />Play now</Link>
                      <Link to={t.practice} className="px-btn ghost">{t.practiceLabel}</Link>
                    </div>
                  </div>
                </article>
              </PixelCard>
            );
            return rich && hot === t.game
              ? <ElectricBorder key={t.game} className="gx-hot" color="#b8ff3d" speed={0.8} chaos={0.35} thickness={1.2} strands={2} glow={0.45} intensity={0.7} arcs={1} borderRadius={2} interactive={false} theme="dark">{cab}</ElectricBorder>
              : <Fragment key={t.game}>{cab}</Fragment>;
          })}
        </div>
      </section>

      <section className="lx-sec gx-lounge" aria-label="The lounge">
        <Lounge create />
      </section>

      <section className="lx-sec gx-prizes" aria-label="This week's prizes">
        <WeeklyPrizes />
      </section>

      <section className="lx-sec" aria-labelledby="gr-stake">
        <PxPanel title="STAKES · OPTIONAL" tone="gold" right="18+ · ONLY WHERE ALLOWED" className="gx-stake">
          <details className="clarity-more gx-more"><summary>Choose token stakes · how it works</summary>
          <h2 id="gr-stake">Playing for a stake</h2>
          <ol className="gx-steps">
            <li><b>Open a challenge.</b> Pick the game and the amount, say 100,000 $SHIFT. One confirmation in your wallet puts it in the GameEscrow contract, not with NIGHTSHIFT.</li>
            <li><b>A rival joins</b> with the same amount. Both of you get a "Take your seat" banner on any page; the clock starts once you are both at the table.</li>
            <li><b>You play.</b> The server runs the game, checks every move or shot, and signs the result.</li>
            <li><b>The contract pays.</b> The winner gets 95% of the pot, paid by the contract; a draw, or a game one of you never got to play, refunds both. If the payout is slow, you can send the signed result from your own wallet.</li>
          </ol>
          <p className="gx-fine">The 5% fee is sent to FeeSplitter on Ethereum. Rewards depend on assets received and distribution. Contract <a href="https://etherscan.io/address/0xf460fd9ad76f18414f54a2431870e8a116193489" target="_blank" rel="noreferrer">0xf460…3489 ↗</a>.</p>
          </details>
        </PxPanel>
      </section>

      <section className="lx-sec" aria-labelledby="gr-fair">
        <PxPanel title="FAIR PLAY" right="NO HOUSE EDGE">
          <h2 id="gr-fair" className="gx-h">Fair play</h2>
          <ul className="lx-rails gx-fair">
            <li><b>Your stake stays in the contract</b> until the result: nobody at NIGHTSHIFT can move it, only pay it to one of the two players or back to both.</li>
            <li><b>A dropped phone is not a lost game.</b> In a staked game you have 2 minutes in all to come back on your turn, and your rival sees the countdown.</li>
            <li><b>You play people.</b> No house edge: the fee is the only cut, the same in every game.</li>
          </ul>
          <p className="gx-legal"><PxIcon name="lock" size={13} />Free games need no wallet. Staked games: 18+, only where allowed.</p>
        </PxPanel>
      </section>

      <section className="lx-sec gx-connect">
        <HowThisConnects current="games" />
      </section>
      <Link to="/arena" className="gx-arena">
        <img src="/frogs/frog-112.webp" alt="" width={84} height={84} loading="lazy" decoding="async" />
        <span><b>AI / Arena</b>AI agents play NIGHT CHESS against each other and against you.</span>
        <Icon name="arrow" size={16} />
      </Link>
    </div>
  );
}
