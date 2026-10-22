import { useState } from "react";
import { NxIcon } from "./nx/icons";

/**
 * The step-by-step guide on /watch: how the Night Watch works in one picture, what you need, and two ways to
 * run the bot (your own computer, or a rented server that sets itself up from one pasted box).
 * Scripts it shows are nightwatch/install.sh, nightwatch/vps-setup.sh and nightwatch/cloud-init.yaml (docs/nightwatch/VPS.md has the research).
 */
const SITE = "https://getnightshift.tech";
const INSTALL = `curl -fsSL ${SITE}/nightwatch/install.sh | bash`;
// the same as nightwatch/cloud-init.yaml, without the comments
const CLOUD_INIT = `#cloud-config
package_update: true
packages: [curl, ca-certificates]
runcmd:
  - [ bash, -c, "curl -fsSL ${SITE}/nightwatch/vps-setup.sh | bash > /var/log/nightwatch-setup.log 2>&1; cat /var/log/nightwatch-setup.log > /dev/console 2>/dev/null || true" ]
`;
/** Referral links go here once the owner has registered them (docs/nightwatch/VPS.md). Plain links until then. */
const PROVIDERS = {
  digitalocean: { name: "DigitalOcean", url: "https://www.digitalocean.com/", ref: false },
  hetzner: { name: "Hetzner", url: "https://www.hetzner.com/cloud/", ref: false },
} as const;

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const go = () => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); };
  return <button type="button" className="nx-btn nx-btn-sm" onClick={go}>{done ? "Copied" : label}</button>;
}
function Cmd({ text, multi }: { text: string; multi?: boolean }) {
  return (
    <div className={`nwg-cmd${multi ? " multi" : ""}`}>
      <pre><code>{text.trimEnd()}</code></pre>
      <Copy text={text} />
    </div>
  );
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="nwg-step">
      <span className="nwg-n">{n}</span>
      <div><b>{title}</b>{children}</div>
    </li>
  );
}
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;

export function WatchGuide({ mat, lullHours }: { mat: number; lullHours: number }) {
  const [path, setPath] = useState<"server" | "own">("server");
  const [prov, setProv] = useState<"digitalocean" | "hetzner">("digitalocean");
  const p = PROVIDERS[prov];
  return (
    <>
      <section className="fg-sec" id="how">
        <div className="fg-head"><span className="fg-kicker">How it works</span><h2>One bot, one seat, four moves</h2></div>
        <ol className="nwg-flow">
          <li><i>1</i><b>A loan goes under</b><span>IMD falls and someone's imdUSD loan drops below {mat}% backing.</span></li>
          <li><i>2</i><b>A seat marks it</b><span>The Night Watch picks one seat to mark the loan. The borrower gets about {lullHours} hours to top up.</span></li>
          <li><i>3</i><b>The seats liquidate together</b><span>If it is still under, the seats repay the debt with their imdUSD, each taking its share. No racing each other.</span></li>
          <li><i>4</i><b>The bonus is shared</b><span>Each seat gets staked IMD worth the debt it repaid plus a bonus. A small cut of the bonus goes to $SHIFT stakers and frog holders.</span></li>
        </ol>
        <p className="st-note">Your bot does all four on its own. Most days nothing happens: loans only go under when IMD drops hard. Then the bot wakes up, and you do not have to be there.</p>
      </section>

      <section className="fg-sec" id="need">
        <div className="fg-head"><span className="fg-kicker">Before you start</span><h2>What you need</h2></div>
        <div className="nwg-need">
          <article><b>A Night Watcher</b><span>Your seat. Forge one, or hold NIGHT FROG #1 for the Captain's seat.</span></article>
          <article><b>A little ETH</b><span>About 0.03 ETH for gas. It goes to the bot's own wallet, not your main one.</span></article>
          <article><b>A computer that stays on</b><span>Your own always-on machine, or a rented server for about $6 a month. You pay the server yourself.</span></article>
          <article><b>Optional: imdUSD</b><span>To liquidate you need imdUSD to repay with (it comes back as staked IMD plus the bonus). Without it the seat still marks loans.</span></article>
        </div>
      </section>

      <section className="fg-sec" id="run">
        <div className="fg-head"><span className="fg-kicker">Step by step</span><h2>Where will the bot live?</h2></div>
        <div className="nwg-pick" role="tablist" aria-label="Where to run the bot">
          <button role="tab" aria-selected={path === "server"} className={path === "server" ? "on" : ""} onClick={() => setPath("server")}>
            <b>Rent a server</b><em>Recommended · from about $6 a month</em><span>Always on, nothing to leave running at home. Sets itself up.</span>
          </button>
          <button role="tab" aria-selected={path === "own"} className={path === "own" ? "on" : ""} onClick={() => setPath("own")}>
            <b>Use my computer</b><em>Free</em><span>Works while the machine is on and awake. Mac, Linux, or Windows with WSL.</span>
          </button>
        </div>

        {path === "server" ? (
          <div className="nwg-panel">
            <p className="nwg-lead">A server is a small computer you rent. You paste one box of text when you create it and it installs the bot by itself. The bot's wallet key is made on that server and stays there: NIGHTSHIFT never sees it.</p>
            <div className="nwg-prov" role="tablist" aria-label="Provider">
              {(Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map((k) => (
                <button key={k} role="tab" aria-selected={prov === k} className={prov === k ? "on" : ""} onClick={() => setProv(k)}>{PROVIDERS[k].name}<small>{k === "digitalocean" ? "$6 / month" : "about €6 / month"}</small></button>
              ))}
            </div>
            <ol className="nwg-list">
              <Step n={1} title={`Make an account at ${p.name}`}>
                <p>Go to <Ext href={p.url}>{p.name}</Ext> and sign up. You pay with a card{prov === "digitalocean" ? " or PayPal" : ""}; the server is billed to you, by the month.{p.ref ? " (This is a referral link: it helps NIGHTSHIFT at no cost to you.)" : ""}</p>
              </Step>
              {prov === "digitalocean" ? (
                <Step n={2} title="Create a Droplet (that is DigitalOcean's word for a server)">
                  <p>Click <b>Create</b>, then <b>Droplets</b>. Choose a region near you. Image: <b>Ubuntu 24.04 (LTS)</b>. Size: <b>Basic, Regular, 1 GB / 1 CPU, $6/mo</b>. Under authentication pick <b>Password</b> and type a long one you will keep.</p>
                </Step>
              ) : (
                <Step n={2} title="Create a server">
                  <p>In the Hetzner Console open a project, click <b>Servers</b>, then <b>Add server</b>. Pick a location near you. Image: <b>Ubuntu 24.04</b>. Type: <b>Cost-Optimized CX23</b> (2 CPU, 4 GB, about €6 a month; if it shows as sold out, pick the next one up). Skip the SSH key: Hetzner emails you a password.</p>
                </Step>
              )}
              <Step n={3} title="Paste this into the setup box">
                <p>{prov === "digitalocean" ? <>Open <b>Advanced Options</b>, turn on the <b>startup scripts</b> option (also called initialization scripts) and paste the text below into the box.</> : <>Find the <b>Cloud config</b> box (below Labels) and paste the text below into it.</>}</p>
                <Cmd text={CLOUD_INIT} multi />
                <p className="nwg-small">It only downloads and runs <Ext href={`${SITE}/nightwatch/vps-setup.sh`}>this short script</Ext> (open it and read it first if you like). It installs the bot in watch-only mode: it sends nothing until you say so.</p>
              </Step>
              <Step n={4} title="Create the server and wait about 4 minutes">
                <p>Click {prov === "digitalocean" ? <b>Create Droplet</b> : <b>Create &amp; buy now</b>}. The server starts and installs the bot while you wait.</p>
              </Step>
              <Step n={5} title="Open the server's console and read your link">
                <p>On the server's page click <b>Console</b> (in DigitalOcean: <b>Access</b>, then <b>Launch Droplet Console</b>). Log in as <b>root</b> with your password. A box titled NIGHT WATCH shows your keeper address and a pairing link. If you missed it, type:</p>
                <Cmd text="nightwatch-link" />
                <p className="nwg-small">Nothing there yet? Setup is still running. Wait a minute and log in again.</p>
              </Step>
              <Step n={6} title="Send the keeper some ETH">
                <p>The address in that box is your bot's own wallet, made on the server. Send it about 0.03 ETH on Ethereum mainnet from any wallet (never put your Night Watcher in it). Add imdUSD later if you want to liquidate.</p>
              </Step>
              <Step n={7} title="Pair it with your Night Watcher">
                <p>Open the pairing link, or use <a href="#pair">the pair box below</a>: connect the wallet that holds your Night Watcher and sign. Signing costs nothing.</p>
              </Step>
            </ol>
          </div>
        ) : (
          <div className="nwg-panel">
            <p className="nwg-lead">Use a Mac or Linux machine that stays on, or the box that already runs your IMD worker. You need <Ext href="https://nodejs.org">Node.js</Ext> 20 or newer. The bot's wallet key is made on your machine and stays there.</p>
            <ol className="nwg-list">
              <Step n={1} title="Open a terminal and paste one line">
                <Cmd text={INSTALL} />
                <p>It installs the bot in a folder called <code>nightwatch</code>, makes a fresh wallet for it and prints a pairing link. Leave it open: it waits for you to sign.</p>
                <p className="nwg-small">On Windows, use WSL (Ubuntu), or run <code>git clone https://github.com/RobertKodes/nightshift</code>, then <code>cd nightshift/nightwatch</code>, <code>npm install</code>, <code>node bot.mjs start</code>.</p>
              </Step>
              <Step n={2} title="Send the keeper some ETH">
                <p>The terminal prints the bot's wallet address. Send it about 0.03 ETH on Ethereum mainnet. Never put your Night Watcher in it.</p>
              </Step>
              <Step n={3} title="Pair it with your Night Watcher">
                <p>Open the pairing link it printed, or use <a href="#pair">the pair box below</a>, connect the wallet that holds your Night Watcher and sign. The terminal says <i>Paired</i>.</p>
              </Step>
              <Step n={4} title="Keep it running">
                <p>Closing the terminal stops the bot. On Linux you can make it start on its own with <code>nightwatch.service</code> (see the <Ext href="https://github.com/RobertKodes/nightshift/tree/main/nightwatch">README</Ext>).</p>
              </Step>
            </ol>
          </div>
        )}

        <div className="nwg-after">
          <h3>When it works</h3>
          <p>The bot prints a line every 15 seconds. On a quiet day you will see <code>idle … no loan to act on</code>. That is normal: it is watching. On the seat list below your seat shows <b>online</b> within a minute.</p>
          <Cmd text={path === "server" ? "nightwatch-check" : "cd ~/nightwatch && node bot.mjs doctor"} />
          <p className="nwg-small">The check lists what is fine and what to fix: gas, imdUSD, pairing, that you still hold the seat.</p>

          <h3>Turn on live mode</h3>
          <p>The bot starts in <b>watch-only</b> mode: it shows what it would do and sends nothing. Watch it for a few days and make sure the check says <i>Ready</i>. Then switch it on. From now on it sends real transactions with the bot wallet.</p>
          <Cmd text={path === "server" ? "nightwatch-live" : "cd ~/nightwatch && node bot.mjs --execute"} />
          {path === "server" && <p className="nwg-small">Back to watching only: <code>nightwatch-report-only</code>.</p>}

          <h3>Stop it, or remove it</h3>
          <p>{path === "server" ? <>To pause, type <code>sudo systemctl stop nightwatch</code>. To stop for good, delete the server in the {p.name} console and the bill ends. First move your ETH and imdUSD out: the key is in <code>/home/nightwatch/nightwatch/.env</code>, and importing it into a wallet lets you send the funds.</> : <>Press <code>Ctrl+C</code> in the terminal. To remove it, delete the <code>nightwatch</code> folder after moving your ETH and imdUSD out; the key is in its <code>.env</code> file. Make a file called <code>state/STOP</code> to freeze all sends without stopping the bot.</>}</p>
        </div>
      </section>

      <section className="fg-sec" id="help">
        <div className="fg-head"><span className="fg-kicker">Common questions</span><h2>Before you ask</h2></div>
        <div className="fg-faq">
          <details><summary>Is my private key safe?</summary><p>The bot's key is made on your machine or your server and written to a private file there. It is never uploaded; NIGHTSHIFT only sees the public address. Two rules: use this wallet only for the bot, and keep your Night Watcher in a different wallet. A rented server's company could in theory read its own disks, as with any server, so keep only working funds in the bot wallet.</p></details>
          <details><summary>What does it cost?</summary><p>The server is about $6 a month, paid to the provider by you (or nothing on your own computer). Gas for marks and liquidations comes out of the bot wallet. On liquidations, the bot pays the NIGHTSHIFT cut from the bonus it earns.</p></details>
          <details><summary>Why are there two providers?</summary><p>They are the two simplest ones that let you paste a setup box when you create the server. Any Ubuntu 24.04 server with that box works. NIGHTSHIFT does not rent servers for you, so it never holds your key.</p></details>
          <details><summary>What if the machine is off?</summary><p>Nothing breaks. The bot just does not act while it is off, and the other seats keep working. The seat shows <i>offline</i>, and you start the bot again to carry on. On a rented server a crash restarts it by itself.</p></details>
          <details><summary>Can it lose my money?</summary><p>In watch-only mode it cannot send anything. In live mode every transaction is simulated first, and it stops when gas is high or the ETH is low. The real risk is the price of the staked IMD you are paid in.</p></details>
        </div>
        <p className="st-note"><NxIcon name="security" size={14} /> Server plans, prices and what each provider's referral gives change; check the provider's page before you pay.</p>
      </section>
    </>
  );
}
