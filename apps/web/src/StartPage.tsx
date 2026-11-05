import { useEffect, useState } from "react";
import { OPENSEA_URL } from "./landing/chrome";
import { Link } from "./router";
import PixelCard from "./rb/PixelCard";
import TextType from "./rb/TextType";
import DecryptedText from "./rb/DecryptedText";
import { PxHero, PxPanel, PxStat, PxStats, PxTag } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxBg, LxStar, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";
import "./start.css";

const SHIFT_ADDRESS = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";

const WORDS = [
  ["Wallet", "An app that holds your digital coins and lets you sign in without a password."],
  ["Recovery phrase", "The secret 12 or 24 words that control your wallet and let you recover it."],
  ["Ethereum", "The network of computers that $SHIFT lives on."],
  ["ETH", "Ethereum's own coin, used to pay its network fees."],
  ["Token", "A digital coin or collectible on a network such as Ethereum."],
  ["$SHIFT", "NIGHTSHIFT's own token, which you can hold for perks or stake for a share of rewards."],
  ["Swap", "Exchanging one digital coin for another."],
  ["Gas fee", "The network fee you pay in ETH for an action on Ethereum."],
  ["Staking", "Locking your $SHIFT in the rewards contract to share in the station's rewards."],
  ["Burn", "Removing tokens for good so nobody can use them again."],
  ["NFT (NIGHT FROGS)", "A token that identifies a unique collectible, such as one of the station's NIGHT FROGS."],
  ["Smart contract", "A program on Ethereum that follows rules written in code."],
  ["AI agent", "A computer program that uses artificial intelligence to carry out tasks."],
  ["IMD", "The network of AI agents that built and runs much of NIGHTSHIFT's work."],
] as const;

/** What the guide's terminal types out: the page's own promises, one line each. */
const PROMPTS = ["gm", "no account, no wallet to look around", "play a game, try a tool", "get $SHIFT when you're ready"];

/** Decorative art keeps its space and falls back to a pixel icon if an asset is unavailable. */
function StartArt({ file, icon, hero = false, className = "lx-art" }: { file: string; icon: string; hero?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const size = hero ? 1024 : 768;
  return (
    <div className={className} aria-hidden="true">
      {failed ? <PxIcon name={icon} size={hero ? 120 : 48} /> : (
        <img src={`/art/v2/${file}.webp`} alt="" width={size} height={size}
          loading={hero ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

/** The three ways in. In the hero the first one is the page's one starred call to action. */
function FirstSteps({ star = false }: { star?: boolean }) {
  return (
    <>
      {star ? (
        <LxStar to="/games" icon="play">Play a free game</LxStar>
      ) : <Link to="/games" className="px-btn primary"><PxIcon name="play" size={14} />Play a free game</Link>}
      <Link to="/services/verdict" className="px-btn"><PxIcon name="shield" size={14} />Try a free token check</Link>
      <a href="#steps" className="px-btn ghost"><PxIcon name="coin" size={14} />Get $SHIFT step by step</a>
    </>
  );
}

const DOORS = [
  { art: "door-play-768", icon: "play", title: "Play", line: "Pinball, chess, pool and poker. Practice for free, with no wallet. Real-money duels are optional.", to: "/games", go: "Browse the games" },
  { art: "door-tools-768", icon: "bot", title: "AI tools", line: "Check if a token looks safe before you buy. Watch it for changes, or do some research. Previews are free. Paid work uses USDC, a digital coin tied to the US dollar.", to: "/services", go: "Explore the AI tools" },
  { art: "door-shift-768", icon: "coin", title: "$SHIFT", line: "The station's own token. Hold it for perks, or stake it (lock it in the rewards program) to earn a share of every sell.", to: "/token", go: "Learn about $SHIFT" },
];

export function StartPage() {
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");
  const rich = useRich();

  useEffect(() => { document.title = "Start here · NIGHTSHIFT"; }, []);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(SHIFT_ADDRESS);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="lx lx-start">
      <PxHero
        kicker="START HERE"
        title={<>New here?<br />Start with</>}
        accent="the night shift."
        bg={<LxBg rich={rich} />}
        lead={<>
          NIGHTSHIFT is a space station run by AI agents (programs that do work on their own) and a crew of frogs. You can play games and try the AI tools for free: no account, no wallet.
          <span className="lx-lead2">When you want to own a piece of it, this guide walks you through $SHIFT, the station&apos;s own token, one step at a time.</span>
        </>}
        actions={<FirstSteps star />}
        aside={
          <aside className="lx-guide" aria-label="The station's guide">
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>ONBOARDING</b>
              <span className="px-term-state"><i />5-MIN READ</span>
            </div>
            <div className="lx-frog">
              <span className="lx-frog-gm" aria-hidden="true"><img src="/brand/pepe-pixel.svg" alt="" width={14} height={14} />GM, FROG</span>
              <StartArt file="guide-frog-1024" icon="bot" hero className="sp-art" />
            </div>
            <div className="px-term-f">
              <span>root@nightshift:~$</span>
              <TextType text={PROMPTS} typingSpeed={46} deletingSpeed={24} pauseDuration={1700} cursorCharacter="█" cursorStyle="block" cursorColor="#b8ff3d" startOnVisible />
            </div>
          </aside>
        }
      />
      <div className="lx-badges">
        <PxTag tone="lime">NO ACCOUNT</PxTag><PxTag tone="lime">NO WALLET TO LOOK</PxTag><PxTag>FREE GAMES</PxTag><PxTag>FREE PREVIEWS</PxTag><PxTag tone="dim">NOT FINANCIAL ADVICE</PxTag>
      </div>

      <section className="lx-sec" aria-labelledby="sp-doors-heading">
        <div className="lx-sec-head"><div><span className="px-kicker">THREE DOORS</span><h2 className="px-h2" id="sp-doors-heading">Three things you can do here</h2></div></div>
        <div className="lx-doors">
          {DOORS.map((d, i) => (
            <PixelCard key={d.to} className="lx-door" colors={["#b8ff3d", "#57d97b", "#1f6b3a"]} gap={7} speed={30} pixelSize={2} trigger="hover" radius={2} glow={0.3} spotlight={0.3} intro={false} noFocus theme="dark">
              <article className="lx-door-in">
                <span className="lx-door-n">0{i + 1} · {d.title.toUpperCase()}</span>
                <StartArt file={d.art} icon={d.icon} />
                <h3>{d.title}</h3>
                <p>{d.line}</p>
                <Link to={d.to} className="lx-go">{d.go}</Link>
              </article>
            </PixelCard>
          ))}
        </div>
      </section>

      <section className="lx-sec" aria-labelledby="sp-wallet-heading">
        <PxPanel title="BEFORE YOU BUY" tone="gold" className="lx-wallet" right="READ THIS ONCE">
          <div className="lx-wallet-ic" aria-hidden="true"><PxIcon name="wallet" size={28} /></div>
          <div>
            <h2 id="sp-wallet-heading">What is a wallet?</h2>
            <p>A wallet is an app that holds your coins. It also lets you sign in to sites like this one without a password.</p>
            <p>Your secret recovery phrase, a set of 12 or 24 words, controls everything in your wallet. <strong>Write it on paper. Never type it into a website. Never share it.</strong></p>
          </div>
        </PxPanel>
      </section>

      <section id="steps" className="lx-sec" aria-labelledby="sp-steps-heading" tabIndex={-1}>
        <div className="lx-sec-head">
          <div>
            <span className="px-kicker">When you&apos;re ready</span>
            <h2 className="px-h2" id="sp-steps-heading">Getting $SHIFT in five steps</h2>
            <p className="px-sub">Take your time. You can keep playing and exploring for free.</p>
          </div>
        </div>
        <ol className="lx-steps" role="list">
          <li className="lx-step">
            <span className="lx-step-n" aria-hidden="true">01</span>
            <div className="lx-step-copy">
              <h3>Get a wallet</h3>
              <p>MetaMask, Rabby, Rainbow or any wallet that supports WalletConnect, a way to connect your wallet to a site, works here.</p>
              <p>Install it from the official site or app store only.</p>
            </div>
            <StartArt file="start-wallet-768" icon="wallet" />
          </li>
          <li className="lx-step">
            <span className="lx-step-n" aria-hidden="true">02</span>
            <div className="lx-step-copy">
              <h3>Add some ETH</h3>
              <p>ETH is the coin of Ethereum, the network of computers that $SHIFT lives on. Buy it inside your wallet app or on an exchange, a service for buying and selling coins. Then send it to your wallet address, the code that tells it where to go.</p>
              <p>Keep a little extra. Every action on Ethereum costs a small network fee, called &ldquo;gas&rdquo;, paid in ETH.</p>
            </div>
            <div className="lx-sym" aria-hidden="true"><PxIcon name="coin" size={52} /></div>
          </li>
          <li className="lx-step">
            <span className="lx-step-n" aria-hidden="true">03</span>
            <div className="lx-step-copy">
              <h3>Swap ETH for $SHIFT</h3>
              <p>A swap means exchanging one coin for another. On our Swap page, connect your wallet, choose how much ETH to exchange, then confirm in your wallet.</p>
              <Link to="/swap" className="lx-go">Open the Swap page</Link>
              <p>Before you buy anywhere else, check that the token address, the code that identifies $SHIFT, is exactly this:</p>
              <div className="lx-addr">
                <span className="lx-addr-k" id="sp-address-label">$SHIFT token address</span>
                <div className="lx-addr-row">
                  <code aria-labelledby="sp-address-label">{SHIFT_ADDRESS}</code>
                  <button type="button" className="px-btn" onClick={() => void copyAddress()}>
                    <PxIcon name={copyState === "copied" ? "shield" : "doc"} size={14} />
                    {copyState === "copied" ? "Copied" : "Copy address"}
                  </button>
                </div>
                <span className={copyState === "failed" ? "lx-copy-error" : "lx-sr"} role="status" aria-live="polite">
                  {copyState === "copied" ? "Token address copied." : copyState === "failed" ? "Could not copy. Select the address above and copy it yourself." : ""}
                </span>
              </div>
              <p>Buying has no NIGHTSHIFT fee. Selling pays a 5% fee. That fee is split like this:</p>
              <PxStats cols={4}>
                <PxStat label="To the crew" value="40%" sub="Stakers and NIGHT FROGS holders" tone="lime" />
                <PxStat label="Burned" value="20%" sub="Removed for good" tone="gold" />
                <PxStat label="Treasury" value="20%" sub="The station's shared funds" />
                <PxStat label="Developer" value="20%" sub="Funds the developer" />
              </PxStats>
              <p className="lx-small">Stakers are people who lock their $SHIFT in the rewards program. NIGHT FROGS are the station&apos;s collectible frogs.</p>
            </div>
            <StartArt file="start-buy-768" icon="swap" />
          </li>
          <li className="lx-step">
            <span className="lx-step-n" aria-hidden="true">04</span>
            <div className="lx-step-copy">
              <h3>Stake it to earn</h3>
              <p>Staking means locking your $SHIFT in the rewards contract, a program on Ethereum that follows rules written in code. Stakers share half of the station&apos;s rewards, paid in ETH and $SHIFT over 7 days.</p>
              <p>Choose no lock, or lock for 1 to 24 months. The more you stake and the longer you lock, the bigger your share.</p>
              <p>Your stake stays yours. Nobody else, the team included, can move it.</p>
              <Link to="/stake" className="lx-go">See the staking options</Link>
            </div>
            <StartArt file="start-stake-768" icon="stake" />
          </li>
          <li className="lx-step">
            <span className="lx-step-n" aria-hidden="true">05</span>
            <div className="lx-step-copy">
              <h3>Explore the perks</h3>
              <p>Holding 500,000+ $SHIFT halves the price of our AI checks. Holding 5,000,000+ means no NIGHTSHIFT swap fee. Both count the $SHIFT in your wallet plus what you have staked.</p>
              <p>NIGHT FROGS are the station&apos;s 500 collectible frogs. They&apos;re sold out, but you can trade them on OpenSea, a marketplace for digital collectibles. They also unlock perks.</p>
              <div className="lx-links">
                <Link to="/token" className="lx-go">See all the token perks</Link>
                <a href={OPENSEA_URL} className="lx-go ext" target="_blank" rel="noreferrer">View NIGHT FROGS on OpenSea</a>
              </div>
            </div>
            <div className="lx-sym" aria-hidden="true"><img src="/frogs/frog-077.webp" alt="" width={132} height={132} loading="lazy" decoding="async" /></div>
          </li>
        </ol>
      </section>

      <section className="lx-sec" aria-labelledby="sp-safety-heading">
        <PxPanel title="SAFETY" tone="gold" className="lx-safe" right="READ BEFORE EVERY BUY">
          <StartArt file="start-safety-768" icon="shield" />
          <div className="lx-prose">
            <h2 id="sp-safety-heading">Stay safe</h2>
            <ul>
              <li>Nobody from NIGHTSHIFT will ever ask for your recovery phrase.</li>
              <li>Only use <strong>getnightshift.tech</strong> and the links on it.</li>
              <li>Check the token address before every buy.</li>
              <li>Digital coin (crypto) prices go up and down. Only use money you can afford to lose.</li>
            </ul>
            <p className="lx-small">Nothing here is financial advice.</p>
          </div>
        </PxPanel>
      </section>

      <section className="lx-sec" aria-labelledby="sp-words-heading">
        <div className="lx-sec-head"><div><span className="px-kicker">GLOSSARY</span><h2 className="px-h2" id="sp-words-heading">Words you&apos;ll see</h2><p className="px-sub">The same ideas, in plain words.</p></div></div>
        <dl className="lx-gloss">
          {WORDS.map(([word, meaning]) => <div key={word}><dt>{word}</dt><dd>{meaning}</dd></div>)}
        </dl>
      </section>

      <section className="lx-sec" aria-labelledby="sp-faq-heading">
        <div className="lx-sec-head"><div><span className="px-kicker">QUESTIONS</span><h2 className="px-h2" id="sp-faq-heading">A few common questions</h2></div></div>
        <div className="px-faq">
          <details><summary>Do I need a wallet to play?</summary><p>No. Practice games are free. You only need a wallet for real-money duels, prizes, and buying or staking.</p></details>
          <details><summary>Does it cost anything to look around?</summary><p>No. You can explore the station for free.</p></details>
          <details>
            <summary>Who runs NIGHTSHIFT?</summary>
            <p>An independent developer, with the IMD AI agent network doing much of the building. The code is public on GitHub.</p>
            <div className="lx-faq-links"><a href="https://github.com/RobertKodes/nightshift" className="lx-go ext" target="_blank" rel="noreferrer">Read the code on GitHub</a></div>
          </details>
          <details>
            <summary>Where can I ask a question?</summary>
            <p>Join our Telegram group, or find us on X.</p>
            <div className="lx-faq-links">
              <a href="https://t.me/getnightshift" className="lx-go ext" target="_blank" rel="noreferrer">Open the Telegram group</a>
              <a href="https://x.com/nightshiftimd" className="lx-go ext" target="_blank" rel="noreferrer">Find NIGHTSHIFT on X</a>
            </div>
          </details>
        </div>
      </section>

      <section className="lx-sec" aria-labelledby="sp-closing-heading">
        <div className="px-close">
          <div className="px-close-body">
            <img className="px-close-art" src="/brand/pepe-operator.svg" alt="" width={56} height={56} loading="lazy" />
            <div>
              <span className="px-kicker">GM · ALWAYS SHIPPING</span>
              <h2 id="sp-closing-heading"><DecryptedText text="Pick your first step" animateOn="view" sequential speed={28} characters="█▓▒░01" /></h2>
              <p>Play a little, try a tool, or come back to the guide.</p>
            </div>
          </div>
          <div className="px-cta-row"><FirstSteps /></div>
        </div>
      </section>
    </div>
  );
}
