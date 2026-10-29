import { useEffect, useState } from "react";
import { NxIcon } from "./nx/icons";
import { OPENSEA_URL } from "./landing/chrome";
import { Link } from "./router";
import { Stat } from "./station/Station";
import "./forge.css";
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

/** Decorative art keeps its space and falls back to a station icon if an asset is unavailable. */
function StartArt({ file, icon, hero = false }: { file: string; icon: string; hero?: boolean }) {
  const [failed, setFailed] = useState(false);
  const size = hero ? 1024 : 768;
  return (
    <div className={`sp-art${hero ? " sp-guide" : ""}`} aria-hidden="true">
      {failed ? <NxIcon name={icon} size={hero ? 180 : 64} /> : (
        <img src={`/art/v2/${file}.webp`} alt="" width={size} height={size}
          loading={hero ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function FirstSteps() {
  return (
    <div className="fg-cta">
      <Link to="/games" className="nx-btn nx-btn-acc"><NxIcon name="play" size={18} />Play a free game</Link>
      <Link to="/services/verdict" className="nx-btn"><NxIcon name="security" size={18} />Try a free token check</Link>
      <a href="#steps" className="nx-btn"><NxIcon name="token" size={18} />Get $SHIFT step by step</a>
    </div>
  );
}

export function StartPage() {
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");

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
    <div className="st-room fg sp">
      <header className="fg-hero">
        <div className="fg-hero-in">
          <span className="fg-eyebrow"><NxIcon name="guide" size={17} />Start here</span>
          <h1>New here?<br />Start with the night shift.</h1>
          <p className="fg-lead">NIGHTSHIFT is a space station run by AI agents (programs that do work on their own) and a crew of frogs. You can play games and try the AI tools for free: no account, no wallet.</p>
          <p className="fg-lead">When you want to own a piece of it, this guide walks you through $SHIFT, the station&apos;s own token, one step at a time.</p>
          <FirstSteps />
        </div>
        <div className="fg-show">
          <StartArt file="guide-frog-1024" icon="frogs" hero />
        </div>
      </header>

      <div className="st-body">
        <section className="fg-sec" aria-labelledby="sp-doors-heading">
          <div className="fg-head"><h2 id="sp-doors-heading">Three things you can do here</h2></div>
          <div className="fg-perks sp-doors">
            <article className="fg-perk sp-door-play">
              <StartArt file="door-play-768" icon="play" />
              <h3>Play</h3>
              <p>Pinball, chess, pool and poker. Practice for free, with no wallet. Real-money duels are optional.</p>
              <Link to="/games" className="sp-link">Browse the games<NxIcon name="arrow" size={18} /></Link>
            </article>
            <article className="fg-perk sp-door-tools">
              <StartArt file="door-tools-768" icon="agent" />
              <h3>AI tools</h3>
              <p>Check if a token looks safe before you buy. Watch it for changes, or do some research. Previews are free. Paid work uses USDC, a digital coin tied to the US dollar.</p>
              <Link to="/services" className="sp-link">Explore the AI tools<NxIcon name="arrow" size={18} /></Link>
            </article>
            <article className="fg-perk sp-door-shift">
              <StartArt file="door-shift-768" icon="token" />
              <h3>$SHIFT</h3>
              <p>The station&apos;s own token. Hold it for perks, or stake it (lock it in the rewards program) to earn a share of every sell.</p>
              <Link to="/token" className="sp-link">Learn about $SHIFT<NxIcon name="arrow" size={18} /></Link>
            </article>
          </div>
        </section>

        <section className="fg-sec sp-wallet" aria-labelledby="sp-wallet-heading">
          <div className="sp-wallet-icon" aria-hidden="true"><NxIcon name="wallet" size={32} /></div>
          <div>
            <div className="fg-head"><span className="fg-kicker">Before you buy</span><h2 id="sp-wallet-heading">What is a wallet?</h2></div>
            <p>A wallet is an app that holds your coins. It also lets you sign in to sites like this one without a password.</p>
            <p>Your secret recovery phrase, a set of 12 or 24 words, controls everything in your wallet. <strong>Write it on paper. Never type it into a website. Never share it.</strong></p>
          </div>
        </section>

        <section id="steps" className="fg-sec sp-steps-section" aria-labelledby="sp-steps-heading" tabIndex={-1}>
          <div className="fg-head">
            <span className="fg-kicker">When you&apos;re ready</span>
            <h2 id="sp-steps-heading">Getting $SHIFT in five steps</h2>
            <p className="fg-dim">Take your time. You can keep playing and exploring for free.</p>
          </div>
          <ol className="fg-steps sp-steps" role="list">
            <li>
              <StartArt file="start-wallet-768" icon="wallet" />
              <div className="sp-step-copy">
                <h3>Get a wallet</h3>
                <p>MetaMask, Rabby, Rainbow or any wallet that supports WalletConnect, a way to connect your wallet to a site, works here.</p>
                <p>Install it from the official site or app store only.</p>
              </div>
            </li>
            <li>
              <div className="sp-step-symbol" aria-hidden="true"><NxIcon name="money" size={52} /></div>
              <div className="sp-step-copy">
                <h3>Add some ETH</h3>
                <p>ETH is the coin of Ethereum, the network of computers that $SHIFT lives on. Buy it inside your wallet app or on an exchange, a service for buying and selling coins. Then send it to your wallet address, the code that tells it where to go.</p>
                <p>Keep a little extra. Every action on Ethereum costs a small network fee, called &ldquo;gas&rdquo;, paid in ETH.</p>
              </div>
            </li>
            <li>
              <StartArt file="start-buy-768" icon="swap" />
              <div className="sp-step-copy">
                <h3>Swap ETH for $SHIFT</h3>
                <p>A swap means exchanging one coin for another. On our Swap page, connect your wallet, choose how much ETH to exchange, then confirm in your wallet.</p>
                <Link to="/swap" className="sp-link">Open the Swap page<NxIcon name="arrow" size={18} /></Link>
                <p>Before you buy anywhere else, check that the token address, the code that identifies $SHIFT, is exactly this:</p>
                <div className="sp-address">
                  <span className="sp-address-label" id="sp-address-label">$SHIFT token address</span>
                  <div className="sp-address-row">
                    <code aria-labelledby="sp-address-label">{SHIFT_ADDRESS}</code>
                    <button type="button" className="nx-btn" onClick={() => void copyAddress()}>
                      <NxIcon name={copyState === "copied" ? "security" : "terms"} size={17} />
                      {copyState === "copied" ? "Copied" : "Copy address"}
                    </button>
                  </div>
                  <span className={copyState === "failed" ? "sp-copy-error" : "sp-sr"} role="status" aria-live="polite">
                    {copyState === "copied" ? "Token address copied." : copyState === "failed" ? "Could not copy. Select the address above and copy it yourself." : ""}
                  </span>
                </div>
                <p>Buying has no NIGHTSHIFT fee. Selling pays a 5% fee. That fee is split like this:</p>
                <div className="st-stats sp-fees">
                  <Stat label="To the crew" value="40%" note="Stakers and NIGHT FROGS holders" />
                  <Stat label="Burned" value="20%" note="Removed for good" />
                  <Stat label="Treasury" value="20%" note="The station's shared funds" />
                  <Stat label="Developer" value="20%" note="Funds the developer" />
                </div>
                <p className="sp-small">Stakers are people who lock their $SHIFT in the rewards program. NIGHT FROGS are the station&apos;s collectible frogs.</p>
              </div>
            </li>
            <li>
              <StartArt file="start-stake-768" icon="stake" />
              <div className="sp-step-copy">
                <h3>Stake it to earn</h3>
                <p>Staking means locking your $SHIFT in the rewards contract, a program on Ethereum that follows rules written in code. Stakers share half of the station&apos;s rewards, paid in ETH and $SHIFT over 7 days.</p>
                <p>Choose no lock, or lock for 1 to 24 months. The more you stake and the longer you lock, the bigger your share.</p>
                <p>Your stake stays yours. Nobody else, the team included, can move it.</p>
                <Link to="/stake" className="sp-link">See the staking options<NxIcon name="arrow" size={18} /></Link>
              </div>
            </li>
            <li>
              <div className="sp-step-symbol" aria-hidden="true"><NxIcon name="frogs" size={52} /></div>
              <div className="sp-step-copy">
                <h3>Explore the perks</h3>
                <p>Holding 500,000+ $SHIFT halves the price of our AI checks. Holding 5,000,000+ means no NIGHTSHIFT swap fee. Both count the $SHIFT in your wallet plus what you have staked.</p>
                <p>NIGHT FROGS are the station&apos;s 500 collectible frogs. They&apos;re sold out, but you can trade them on OpenSea, a marketplace for digital collectibles. They also unlock perks.</p>
                <div className="sp-links">
                  <Link to="/token" className="sp-link">See all the token perks<NxIcon name="arrow" size={18} /></Link>
                  <a href={OPENSEA_URL} className="sp-link" target="_blank" rel="noreferrer">View NIGHT FROGS on OpenSea<NxIcon name="external" size={16} /></a>
                </div>
              </div>
            </li>
          </ol>
        </section>

        <section className="fg-sec sp-safety" aria-labelledby="sp-safety-heading">
          <StartArt file="start-safety-768" icon="security" />
          <div>
            <div className="fg-head"><h2 id="sp-safety-heading">Stay safe</h2></div>
            <ul>
              <li>Nobody from NIGHTSHIFT will ever ask for your recovery phrase.</li>
              <li>Only use <strong>getnightshift.tech</strong> and the links on it.</li>
              <li>Check the token address before every buy.</li>
              <li>Digital coin (crypto) prices go up and down. Only use money you can afford to lose.</li>
            </ul>
            <p className="sp-small">Nothing here is financial advice.</p>
          </div>
        </section>

        <section className="fg-sec" aria-labelledby="sp-words-heading">
          <div className="fg-head"><h2 id="sp-words-heading">Words you&apos;ll see</h2><p className="fg-dim">The same ideas, in plain words.</p></div>
          <dl className="sp-glossary">
            {WORDS.map(([word, meaning]) => <div key={word}><dt>{word}</dt><dd>{meaning}</dd></div>)}
          </dl>
        </section>

        <section className="fg-sec" aria-labelledby="sp-faq-heading">
          <div className="fg-head"><h2 id="sp-faq-heading">A few common questions</h2></div>
          <div className="fg-faq">
            <details><summary>Do I need a wallet to play?</summary><p>No. Practice games are free. You only need a wallet for real-money duels, prizes, and buying or staking.</p></details>
            <details><summary>Does it cost anything to look around?</summary><p>No. You can explore the station for free.</p></details>
            <details>
              <summary>Who runs NIGHTSHIFT?</summary>
              <p>An independent developer, with the IMD AI agent network doing much of the building. The code is public on GitHub.</p>
              <div className="sp-faq-links"><a href="https://github.com/RobertKodes/nightshift" className="sp-link" target="_blank" rel="noreferrer">Read the code on GitHub<NxIcon name="external" size={16} /></a></div>
            </details>
            <details>
              <summary>Where can I ask a question?</summary>
              <p>Join our Telegram group, or find us on X.</p>
              <div className="sp-faq-links">
                <a href="https://t.me/getnightshift" className="sp-link" target="_blank" rel="noreferrer">Open the Telegram group<NxIcon name="external" size={16} /></a>
                <a href="https://x.com/nightshiftimd" className="sp-link" target="_blank" rel="noreferrer">Find NIGHTSHIFT on X<NxIcon name="external" size={16} /></a>
              </div>
            </details>
          </div>
        </section>

        <section className="fg-sec sp-closing" aria-labelledby="sp-closing-heading">
          <div className="fg-head"><h2 id="sp-closing-heading">Pick your first step</h2><p className="fg-dim">Play a little, try a tool, or come back to the guide.</p></div>
          <FirstSteps />
        </section>
      </div>
    </div>
  );
}
