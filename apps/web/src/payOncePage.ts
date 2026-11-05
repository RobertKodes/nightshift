import type { Address } from "viem";
import type { Eip1193 } from "./wallet";
import { formatUsdc, type PayTarget } from "./payOnce";
import { connectWallet, loadPayTargets, payAll, payOne, walletError } from "./payOnceClient";

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

function injected(): Eip1193 | null {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

function basescan(tx: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = `https://basescan.org/tx/${tx}`;
  a.textContent = tx;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function main() {
  const status = $("status");
  const list = $("list");
  const connect = $("connect") as HTMLButtonElement;
  const all = $("all") as HTMLButtonElement;
  let eth: Eip1193 | null = injected();
  let from: Address | null = null;
  let targets: PayTarget[] = [];
  let busy = false;

  const say = (text: string) => { status.textContent = text; };

  const paint = () => {
    list.replaceChildren();
    const total = targets.reduce((sum, t) => sum + BigInt(t.amount), 0n);
    all.textContent = targets.length ? `Pay all, one by one · $${formatUsdc(total)}` : "Pay all, one by one";
    for (const target of targets) {
      const row = document.createElement("li");
      row.className = "row";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Pay ${target.name} · $${target.price}`;
      button.addEventListener("click", () => {
        void run(async () => {
          try {
            const paid = await payOne(eth!, from!, target, say);
            showPaid(row, paid.tx, paid.body);
            say(`Settled ${target.name}.`);
          } catch (e) {
            showFailed(row, walletError(e));
            throw e;
          }
        });
      });
      const path = document.createElement("p");
      path.className = "path";
      path.textContent = target.path;
      const result = document.createElement("div");
      result.className = "result";
      row.append(button, path, result);
      list.append(row);
    }
  };

  function showPaid(row: HTMLElement, tx: string, body: unknown) {
    const result = row.querySelector(".result");
    const button = row.querySelector("button");
    if (button) button.disabled = true;
    if (!result) return;
    result.replaceChildren();
    const line = document.createElement("p");
    line.className = "ok";
    line.append("Settled: ", basescan(tx));
    result.append(line);
    const summary = (body as { summary?: unknown } | null)?.summary;
    if (typeof summary === "string" && summary) {
      const p = document.createElement("p");
      p.textContent = summary;
      result.append(p);
    }
  }

  function showFailed(row: HTMLElement, error: string) {
    const result = row.querySelector(".result");
    if (!result) return;
    result.replaceChildren();
    const line = document.createElement("p");
    line.className = "bad";
    line.textContent = error;
    result.append(line);
  }

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    eth = injected();
    if (!eth) { say("Open this page in Coinbase Wallet, MetaMask, or Rabby. This browser has no wallet."); return; }
    busy = true;
    connect.disabled = true;
    all.disabled = true;
    list.querySelectorAll("button").forEach((b) => { (b as HTMLButtonElement).disabled = true; });
    try {
      if (!from) from = await connectWallet(eth);
      say(`Wallet ${from}`);
      await work();
    } catch (e) {
      say(walletError(e));
    } finally {
      busy = false;
      connect.disabled = false;
      all.disabled = targets.length === 0;
      list.querySelectorAll("button").forEach((b) => {
        const done = b.parentElement?.querySelector(".ok");
        (b as HTMLButtonElement).disabled = Boolean(done);
      });
    }
  }

  connect.addEventListener("click", () => { void run(async () => { say(`Connected ${from}. Base USDC. Nothing is signed until you pay.`); }); });
  all.addEventListener("click", () => {
    void run(async () => {
      const rows = await payAll(eth!, from!, targets, (row) => {
        const item = [...list.children].find((el) => el.querySelector(".path")?.textContent === targets.find((t) => t.id === row.id)?.path);
        if (!item) return;
        if (row.ok) showPaid(item as HTMLElement, row.tx, row.body);
        else showFailed(item as HTMLElement, row.error);
      }, say);
      const settled = rows.filter((r) => r.ok).length;
      say(`Finished ${settled} of ${rows.length}.`);
    });
  });

  say(eth ? "Wallet found. Loading the prices this site advertises…" : "No wallet in this browser. Open the link in Coinbase Wallet, MetaMask, or Rabby.");
  loadPayTargets().then((found) => {
    targets = found;
    paint();
    all.disabled = false;
    say(eth ? "Prices are the ones just read from this site. Tap a button to pay that call once." : "Prices loaded. Open this page in a wallet browser to pay.");
  }).catch((e) => {
    say(walletError(e));
  });
}

main();
