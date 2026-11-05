import { useEffect, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { PxHero, PxPanel } from "./saas/kit";
import { PxIcon } from "./saas/PxIcon";
import "./saas/pages/learn.css";

/**
 * Deleting a NIGHTSHIFT account, from the web: what goes, what stays and why, and the button. The app
 * has the same in Settings; this page is for anyone without the app (Google Play asks for both).
 */
export function DeleteAccountPage() {
  const { address, signIn, signOut, busy } = useSession();
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"idle" | "working" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { document.title = "Delete your account · NIGHTSHIFT"; }, []);

  const erase = async () => {
    setErr(null);
    setStep("working");
    try { await api.deleteAccount(confirm); setStep("done"); await signOut(); } catch (e) { setErr((e as Error).message); setStep("idle"); }
  };

  return (
    <div className="lx lx-delete">
      <PxHero
        kicker="ACCOUNT · WEBSITE + ANDROID APP"
        title="Delete your"
        accent="account"
        lead={<>A NIGHTSHIFT account is a wallet that signed in, on this website or in the NIGHTSHIFT app for Android. Deleting it removes what NIGHTSHIFT keeps about that wallet. In the app it is under <b>More → Settings → Delete account</b>; this page does the same.</>}
      />
      <div className="lx-del-grid">
        <div className="lx-legal lx-prose">
          <section className="lx-clause" aria-labelledby="del-gone">
            <h2 id="del-gone">What is deleted</h2>
            <ul>
              <li>Your API keys, and every session on every device (you are signed out everywhere).</li>
              <li>Your phones: their approval keys, push tokens and notification settings.</li>
              <li>Your player name in the games, and the link between your wallet and browser alerts.</li>
              <li>Your deleted companies stop being tied to your wallet, so they can no longer be restored.</li>
            </ul>
          </section>
          <section className="lx-clause gold" aria-labelledby="del-stays">
            <h2 id="del-stays">What stays, and why</h2>
            <ul>
              <li><b>Running companies</b> hold funds, so they are never deleted silently: stop each one first (that sends its funds back to your wallet) and delete it, then delete the account.</li>
              <li><b>Products people bought</b> stay downloadable for their buyers, and the books of every sale stay as financial records.</li>
              <li><b>Anything on a blockchain</b> (transactions, tokens, NFTs) is public and cannot be removed by anyone.</li>
              <li>Short-lived server logs expire on their own within days.</li>
            </ul>
          </section>
        </div>
        <PxPanel title="DELETE ACCOUNT" state="warn" className="lx-danger">
          <h2>Do it</h2>
          {step === "done" ? (
            <p>✅ Done. Your account is deleted and you are signed out everywhere.</p>
          ) : !address ? (
            <p><button className="px-btn primary" disabled={busy} onClick={() => void signIn()}><PxIcon name="wallet" size={14} />Sign in with the wallet to delete</button></p>
          ) : (
            <>
              <p>Signed in as <span className="mono lx-who">{address.slice(0, 6)}…{address.slice(-4)}</span>. Type <b>DELETE</b> to confirm.</p>
              <div className="lx-confirm">
                <input className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoComplete="off" aria-label="Type DELETE to confirm" />
                <button className="px-btn danger" disabled={confirm.trim() !== "DELETE" || step === "working"} onClick={() => void erase()}>{step === "working" ? "Deleting…" : "Delete my account"}</button>
              </div>
            </>
          )}
          {err && <p className="lx-err">{err}</p>}
          <p className="lx-help">Can't sign in any more? Ask in the <a href="https://t.me/getnightshift" target="_blank" rel="noreferrer">Telegram community</a> or through the <a href="/security">Security page</a>, from the wallet's owner, and it is done by hand.</p>
        </PxPanel>
      </div>
    </div>
  );
}
