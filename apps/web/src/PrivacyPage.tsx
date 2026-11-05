import { useEffect } from "react";
import { PxHero, PxPanel } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import { LxToc } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";

const TOC = [
  { id: "privacy-what-we-keep", label: "What we keep" },
  { id: "privacy-what-we-do-not-do", label: "What we do not do" },
  { id: "privacy-who-else-sees-data", label: "Who else sees data" },
  { id: "privacy-on-your-device", label: "On your device" },
  { id: "privacy-removing-your-data", label: "Removing your data" },
  { id: "privacy-age", label: "Age" },
  { id: "privacy-changes", label: "Changes" },
];

/** The privacy policy: what NIGHTSHIFT keeps, why, who else sees it, and how to remove it. Plain words. */
export function PrivacyPage() {
  useEffect(() => { document.title = "Privacy · NIGHTSHIFT"; }, []);
  return (
    <div className="lx lx-privacy">
      <PxHero
        kicker="PRIVACY · WEBSITE + ANDROID APP"
        title=""
        accent="Privacy"
        lead="What NIGHTSHIFT keeps about you, why, and how to remove it. This covers the website getnightshift.tech and the NIGHTSHIFT app for Android. Updated 30 October 2026."
        actions={<a href="/delete-account" className="px-btn danger"><PxIcon name="close" size={14} />Delete your account</a>}
        aside={
          <aside className="px-term" aria-label="What we do not do, at a glance">
            <div className="px-term-h"><span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span><b>NEVER</b><span className="px-term-state"><i />POLICY</span></div>
            <div className="px-term-body">
              <div className="px-term-row"><PxIcon name="close" size={14} /><span className="px-term-k">Ads, analytics, tracking</span><span className="px-term-v lime">NONE</span></div>
              <div className="px-term-row"><PxIcon name="close" size={14} /><span className="px-term-k">Selling or renting data</span><span className="px-term-v lime">NONE</span></div>
              <div className="px-term-row"><PxIcon name="lock" size={14} /><span className="px-term-k">Seed phrase, private key</span><span className="px-term-v lime">NEVER HELD</span></div>
              <div className="px-term-row"><PxIcon name="close" size={14} /><span className="px-term-k">Contacts, photos, location</span><span className="px-term-v lime">NO ACCESS</span></div>
            </div>
          </aside>
        }
      />
      <div className="lx-cols">
        <LxToc items={TOC} title="SECTIONS" />
        <div className="lx-body lx-legal lx-prose">
          <section className="lx-clause" id="privacy-what-we-keep" aria-labelledby="privacy-what-we-keep-h">
            <h2 id="privacy-what-we-keep-h">What we keep</h2>
            <ul>
              <li><b>Your wallet address</b>, when you sign in with a wallet, and a session cookie that keeps you signed in. A wallet address is public on the blockchain. NIGHTSHIFT never asks for your seed phrase or private key and never holds them.</li>
              <li><b>Email or social sign-in</b> is run by Reown (WalletConnect), which makes the wallet. NIGHTSHIFT receives only the wallet's address.</li>
              <li><b>Games</b>: the player name you choose, your matches, moves, scores and ratings.</li>
              <li><b>Alerts</b>: when you turn on NIGHT SNIPER alerts, your browser's push subscription (an address at your browser's push service and its keys) and the wallet signed in at that moment, so a holder's alerts can come first. Turning alerts off deletes it.</li>
              <li><b>Telegram</b>: if you use the NIGHTSHIFT bot or link Telegram, your Telegram user id and display name. They stay on the server and are never shown.</li>
              <li><b>Companies you run</b>: their settings, records and wallets, as the Terms describe.</li>
              <li><b>The Android app</b>: for each phone you sign in on, a public key the phone made (its private half never leaves the phone's secure hardware and only signs after your fingerprint), the phone's push token from Google's Firebase, a name for the phone and which notes it wants. The app keeps your session and a copy of your desk on the phone, in encrypted storage.</li>
              <li><b>Reports</b>: when you report an answer from a company's AI CEO, that answer and your reason, kept to review the AI's output.</li>
              <li><b>Technical data</b>: your IP address, used briefly to limit requests and stop abuse, and short-lived server logs.</li>
            </ul>
          </section>
          <section className="lx-clause" id="privacy-what-we-do-not-do" aria-labelledby="privacy-what-we-do-not-do-h">
            <h2 id="privacy-what-we-do-not-do-h">What we do not do</h2>
            <ul>
              <li>No ads, no analytics or tracking scripts, no selling or renting of data.</li>
              <li>No access to your contacts, photos, location or other apps.</li>
            </ul>
          </section>
          <section className="lx-clause" id="privacy-who-else-sees-data" aria-labelledby="privacy-who-else-sees-data-h">
            <h2 id="privacy-who-else-sees-data-h">Who else sees data</h2>
            <ul>
              <li>Transactions you sign are public on their blockchain, as every transaction is.</li>
              <li>Services the site and the app use to work: Reown (wallet connection), Google Firebase Cloud Messaging (delivering the app's notifications: a short text and ids, never keys or balances), Ethereum RPC providers (reading the chain), DexScreener and GeckoTerminal (prices), IMD at imd.fun (orders to the AI swarm), Telegram (the bot), your browser's push service (delivering alerts), and LI.FI and Relay (swaps, on the website). Each sees only what its part needs.</li>
            </ul>
          </section>
          <section className="lx-clause" id="privacy-on-your-device" aria-labelledby="privacy-on-your-device-h">
            <h2 id="privacy-on-your-device-h">On your device</h2>
            <p>The site keeps small settings in your browser (theme, sounds, the wallet you last used) and an offline copy of its pages. Clearing the site's data removes them.</p>
          </section>
          <section className="lx-clause gold" id="privacy-removing-your-data" aria-labelledby="privacy-removing-your-data-h">
            <h2 id="privacy-removing-your-data-h">Removing your data</h2>
            <p>Sign out and turn alerts off at any time. <a href="/delete-account">Delete your account</a> on the website, or in the app under More → Settings: your keys, sessions, phones, player name and alert links go at once. A phone can also be removed alone from the app's Settings. To delete a Telegram link or anything else we keep, ask in the <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram community</a> or through the <a href="/security">Security page</a>, and it is removed. What is on a blockchain cannot be removed by anyone.</p>
          </section>
          <section className="lx-clause" id="privacy-age" aria-labelledby="privacy-age-h">
            <h2 id="privacy-age-h">Age</h2>
            <p>NIGHTSHIFT is for people 18 and over.</p>
          </section>
          <section className="lx-clause" id="privacy-changes" aria-labelledby="privacy-changes-h">
            <h2 id="privacy-changes-h">Changes</h2>
            <p>When this policy changes, the date at the top changes with it.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
