import { useEffect } from "react";
import { onTheWeb } from "./store";
import "./store.css";

/** In the Play Store app: where a part that moves money lives on the website, one tap away in Chrome. */
export function StoreNote({ what, path }: { what: string; path: string }) {
  return (
    <div className="store-note" role="note">
      <b>{what} are on the website</b>
      <span>The NIGHTSHIFT app has NIGHT SNIPER, the free games and the station. This part opens in your browser.</span>
      <a className="store-note-go" href={onTheWeb(path)}>Open getnightshift.tech</a>
    </div>
  );
}

/** A whole page the app leaves to the website (swap, staking, the forge, companies…). */
export function WebOnlyPage({ path }: { path: string }) {
  useEffect(() => { document.title = "On the website · NIGHTSHIFT"; }, []);
  return (
    <div className="store-page">
      <StoreNote what="This part of NIGHTSHIFT and others like it" path={path} />
      <a className="store-back" href="/sniper">Back to NIGHT SNIPER</a>
    </div>
  );
}
