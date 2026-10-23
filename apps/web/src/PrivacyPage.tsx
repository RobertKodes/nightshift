import { useEffect } from "react";

/** The privacy policy: what NIGHTSHIFT keeps, why, who else sees it, and how to remove it. Plain words. */
export function PrivacyPage() {
  useEffect(() => { document.title = "Privacy · NIGHTSHIFT"; }, []);
  return (
    <div className="docs">
      <h1>Privacy</h1>
      <p className="lead">What NIGHTSHIFT keeps about you, why, and how to remove it. This covers the website getnightshift.tech and the NIGHTSHIFT app. Updated 23 October 2026.</p>
      <section className="card"><div className="card-b docs-b">
        <h4>What we keep</h4>
        <ul>
          <li><b>Your wallet address</b>, when you sign in with a wallet, and a session cookie that keeps you signed in. A wallet address is public on the blockchain. NIGHTSHIFT never asks for your seed phrase or private key and never holds them.</li>
          <li><b>Email or social sign-in</b> is run by Reown (WalletConnect), which makes the wallet. NIGHTSHIFT receives only the wallet's address.</li>
          <li><b>Games</b>: the player name you choose, your matches, moves, scores and ratings.</li>
          <li><b>Alerts</b>: when you turn on NIGHT SNIPER alerts, your browser's push subscription (an address at your browser's push service and its keys) and the wallet signed in at that moment, so a holder's alerts can come first. Turning alerts off deletes it.</li>
          <li><b>Telegram</b>: if you use the NIGHTSHIFT bot or link Telegram, your Telegram user id and display name. They stay on the server and are never shown.</li>
          <li><b>Companies you run</b>: their settings, records and wallets, as the Terms describe.</li>
          <li><b>Technical data</b>: your IP address, used briefly to limit requests and stop abuse, and short-lived server logs.</li>
        </ul>
        <h4>What we do not do</h4>
        <ul>
          <li>No ads, no analytics or tracking scripts, no selling or renting of data.</li>
          <li>No access to your contacts, photos, location or other apps.</li>
        </ul>
        <h4>Who else sees data</h4>
        <ul>
          <li>Transactions you sign are public on their blockchain, as every transaction is.</li>
          <li>Services the site uses to work: Reown (wallet connection), Ethereum RPC providers (reading the chain), DexScreener and GeckoTerminal (prices), IMD at imd.fun (orders to the AI swarm), Telegram (the bot), your browser's push service (delivering alerts), and LI.FI and Relay (swaps, on the website). Each sees only what its part needs.</li>
        </ul>
        <h4>On your device</h4>
        <p>The site keeps small settings in your browser (theme, sounds, the wallet you last used) and an offline copy of its pages. Clearing the site's data removes them.</p>
        <h4>Removing your data</h4>
        <p>Sign out and turn alerts off at any time. To delete a game profile, a Telegram link or anything else we keep, ask in the <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram community</a> or through the <a href="/security">Security page</a>, and it is removed. What is on a blockchain cannot be removed by anyone.</p>
        <h4>Age</h4>
        <p>NIGHTSHIFT is for people 18 and over.</p>
        <h4>Changes</h4>
        <p>When this policy changes, the date at the top changes with it.</p>
      </div></section>
    </div>
  );
}
