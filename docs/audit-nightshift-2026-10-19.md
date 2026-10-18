# Audit report

> Security audit of the whole NIGHTSHIFT repository (an autonomous AI company platform built on the IMD swarm, live at getnightshift.tech with real funds). Review: apps/engine (node:http API in server.ts, wallet sign-in and HMAC sessions in auth.ts, the AES-GCM key vault in vault.ts, company wallets and withdrawals, x402 USDC sales and signed download links, the admin dashboard and its token, the keeper that runs the fee splitter and IMD burns in keeper.ts, the Telegram bot and moderation, the MCP server and its API keys, Space Pinball's server replay), packages (core spending policy and shift loop, imd client and payments, x402 seller), and apps/web (every transaction the browser builds with viem: swap through Uniswap v4, staking, NFT claims, funding; the pinned contract addresses in shift.ts; the service workers; the CSP). Find anything that could move or lose funds, bypass ownership or admin checks, leak secrets or private data, enable XSS, SSRF or path traversal, or let a client cheat a game. Rank findings by severity with file and line and a concrete fix.

| | |
|---|---|
| Repository | https://github.com/RobertKodes/nightshift |
| Commit | `882487c8eec36162afc2450491ebc741d1923686` |
| Job | `68591e6d-16e0-4063-a0a2-c9166cfb87fb` |
| Judged | 2026-10-18 21:38 UTC |
| Findings | 1 high · 6 medium · 12 low · 1 info |

Four agents audited the code as it is at `882487c`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. High: Wallet vault is rewritten in place with writeFileSync: one interrupted write destroys every company private key

`apps/engine/src/vault.ts:42`

```
    writeFileSync(this.#file, JSON.stringify(this.#entries, null, 2), { mode: 0o600 });
```

vault.json is the only copy of every company wallet key, the keeper key and every stored app password (AES-GCM encrypted). create() (line 42) and putSecret() (line 56) overwrite the file with a single writeFileSync on the final path. Node opens with O_TRUNC before writing, so a crash, OOM kill (docker-compose caps the container), SIGKILL during `docker compose down`, or ENOSPC mid-write leaves vault.json empty or truncated. The constructor then JSON.parse()s it and throws, or loads a partial object missing already funded entries. store.ts writes state.json.tmp and renameSync()s it; vault.ts does not, and there is no backup copy. In live mode a company wallet holds the owner's IMD and ETH on Ethereum plus its USDC revenue on Base; without the key those funds are unrecoverable. Every new company (POST /api/companies -> vault.create) and every Bluesky connect (putSecret) rewrites the whole file, so the window recurs for the life of the deployment. Fix: write to `${file}.tmp`, fsync, then renameSync over vault.json (as store.ts does), keep the previous file as vault.json.bak, and refuse to start when the parse fails instead of continuing with an empty vault.

**Reproduction**

State: live mode, vault.json holds entries for a funded company A and `keeper`. Input: a second owner calls POST /api/companies, which reaches vault.create(newId) at line 42, and the process is killed (kill -9 / OOM) or the volume returns ENOSPC after open(O_TRUNC) and before the write completes. Expected: A's key survives and only the new company fails. Actual: vault.json is zero-length or truncated; on restart `new Vault()` throws SyntaxError at line 33 (or loads `{}`), vault.account(A.id) throws `no wallet for <id>`, and A's USDC, IMD and ETH can never be signed for again. Compare store.ts lines 71-73, which use tmp + renameSync for the same reason.

### 2. Medium: Withdrawal sends the platform fee legs before the owner's share and re-charges the fee on every retry after the owner transfer fails

`apps/engine/src/engine.ts:933`

```
        for (const [dest, v] of parts) await send(dest, v);
```

Engine.#withdraw computes fee = available * platformFeeBps / 10000 (line 917), then sends dev (20%) and treasury (80%) legs first (line 933) and the owner's transfer last (line 934). If the owner transfer throws after the fee legs landed, the catch (lines 937-940) books only the fee legs against co:<id>:usdc and rethrows; nothing records that the fee on this revenue is already paid. The next withdrawal sees available = total - fee and computes a fresh fee on that remainder, so the same revenue pays the platform fee twice, and again on each further failure. Reachable without an attacker: #withdraw makes three Base transactions but never checks the wallet's Base ETH (the /buy path checks >= 2e13 wei before one transaction), so a wallet with gas for two transfers fails exactly on the third; a Circle-blocklisted owner address, an RPC error, or viem's receipt timeout (no explicit timeout is set on the `sales` client) on the third transfer does the same. Related drift in the same block: if a fee leg is mined but waitForTransactionReceipt throws, txs is empty, nothing is booked, and the ledger's withdrawable exceeds the wallet's USDC, so every later withdrawal reverts on the first fee leg. Fix: send the owner's share first and the fee legs after it (the fee destinations are the platform's own addresses and can be retried), or record a per-company `fee-paid` credit when a fee leg lands and net it on the next attempt; also check the Base ETH balance covers three transfers before sending the first, and set an explicit receipt timeout with a reconcile against the wallet's USDC balance on timeout.

**Reproduction**

State: live mode, PLATFORM_FEE_BPS=500, PLATFORM_TREASURY set, owner holds no SHIFT/frog, ledger co:X:usdc = 100_000_000 (USD 100), the company wallet holds 100 USDC and enough Base ETH for two ERC-20 transfers only. POST /api/companies/X/withdraw. Attempt 1: fee = 5_000_000; send(dev, 1_000_000) ok; send(treasury, 4_000_000) ok; send(owner, 95_000_000) throws (insufficient funds for gas). Catch posts withdraw-fee: co:X:usdc -5_000_000 and rethrows -> HTTP 400. Owner tops up gas and retries. Attempt 2: available = 95_000_000; fee = 4_750_000; owner receives 90_250_000. Expected: owner receives 95.00 USDC in total and the platform 5.00 (5%). Actual (arithmetic checked with the code's integer formula): owner 90.25, platform 9.75, an effective 975 bps. A second failure on attempt 2 pushes the platform's take to 14.26%.

### 3. Medium: Frog epoch builder advances its block cursor and resets everyone's hours even when it assigns nothing, so a window's frog pot or a week's shift hours are dropped for good

`apps/engine/src/frogpot.ts:62`

```
  s.hours = now;
```

buildEpoch sums the frog half of every Distributed event in (s.block, head] (potSince) and the shift hours earned since the last build (earned/sum). Inside the loop a token is skipped with `continue` when total <= 0n (no Distributed event this window) or sum <= 0 (nobody earned hours), or when every share truncates to 0 (line 57). After the loop lines 62-63 unconditionally set s.hours = now and s.block = head and line 64 saves even when tokens is empty and null is returned. Two symmetric losses follow. (a) Pot without hours: the Distributed logs of that window are never read again, no later epoch total includes them, and ShiftRewards holds the ETH/SHIFT in its frog pot with no root that can pay it out. This is the normal state right after launch: the Monday job runs as soon as l.open && contracts.splitter is set (engine.ts:107-110), independent of frogsOn(), and before the NFT exists or accrueStaking has credited anything stakingBoard() is empty. It also happens when staking.json is lost (loadStaking() silently returns an empty state) while frogpot.json still holds last week's hour counts, and whenever the admin presses Build in /setup twice in a row. (b) Hours without pot: in a quiet week (keeper skipped for dust, keeper out of gas, getLogs returned nothing) every holder's hours for that week are consumed with zero payout and the next pot is shared only by hours earned after the reset. Fix: only assign s.hours = now and s.block = head when an epoch was actually produced for every token that had a pot, or carry the unassigned pot (s.carry[token] += total) and unpaid hours forward into the next epoch, and derive each epoch total from the contract's pot balance minus outstanding reservations so that amounts returned after the 30-day claim window are redistributed too.

**Reproduction**

Case A: frogpot.json = {epochs:[],hours:{}} (or absent), staking.json has no wallets (NFT not live yet or accrueStaking never ran), splitter emitted Distributed(token=0x0, rewards=1e18, ...) at block B in (startBlock, head]. Call buildEpoch({splitter, token}, startBlock). potSince returns {0x0: 5e17}; sum = 0 so both tokens `continue`; tokens = []; s.block = head is saved; return null. Next Monday buildEpoch scans from head+1: the 0.5 ETH never appears in any epoch total, no leaf references it, claimsOf() never returns it. Expected: the 0.5 ETH is carried into the next epoch that has hours. Case B: frogpot.json {block: N, hours: {}}; staking board has wallet W with 168 hours and V with 0; no Distributed logs in (N, head]. buildEpoch returns null but frogpot.json now has hours {W: 168} and block = head. The following Monday 1 ETH arrives, W has 168 new hours and V has 168 new hours, so W's first 168 hours are never paid. Running POST /api/admin/frogpot/build twice within a minute reproduces case A for any Distributed events between the two calls.

### 4. Medium: x402 sale is recorded only after the receipt arrives: a settled payment that outlives the request is neither delivered nor booked, and an honest retry charges the buyer twice

`apps/engine/src/server.ts:624`

```
        const tx = await run;
```

The /buy handler submits the buyer's transferWithAuthorization from the company wallet (settlePayment, packages/x402/src/seller.ts:136-146), waits for the receipt, and only then calls recordSale and signs the download link (lines 625-626). Nothing persists the pending settlement before the chain call, and nothing later reconciles incoming USDC against the ledger. If the engine restarts between writeContract and the receipt, or waitForTransactionReceipt rejects (RPC error or 429 while polling, viem's default 180 s timeout during a Base congestion spike, the HTTP request aborted) while the transaction is included afterwards, the buyer's USDC lands in the company wallet but: the catch at the bottom of serve() answers 400 with no deliverable and no PAYMENT-RESPONSE header; recordSale never runs so co:<id>:usdc is not credited and the owner cannot withdraw that revenue (withdrawable() reads only the ledger); the buyer's EIP-3009 nonce is consumed so re-sending the same header reverts on chain (authorizationState(from, nonce) == true) and returns 400 again, and the only way to get the product is to sign and pay a second authorization. The stated purpose at line 592, 'never take money for something that cannot be handed over', is broken. Fix: make settlement idempotent on the authorization. Persist (payer, nonce, value, product, tx hash) before awaiting the receipt and flush it; before and after the send read authorizationState(from, nonce) on USDC, and if the authorization is already consumed with to == c.wallet and value >= price treat it as paid: record the sale once keyed by `${from}:${nonce}` and return the deliverable link; on startup and on a timer complete pending hashes via getTransactionReceipt.

**Reproduction**

State: live mode, company C with a live packaged product P priced 5 USDC, buyer B with 10 USDC on Base, valid PAYMENT-SIGNATURE. Input: GET /buy/C/P; make SALES_RPC answer eth_sendRawTransaction normally but fail eth_getTransactionReceipt (a proxy that drops the method, a provider that 429s, or kill the process after writeContract returns hash H). H is mined a few seconds later. Expected: either B is not charged, or the response carries H and the download link and co:C:usdc += 5 USDC. Actual: the transaction is mined and B's balance drops by 5 USDC; the server responds 400 'Something went wrong' (or nothing, if restarted); store.json has no sale:H entry; engine.ledger.balance(co:C:usdc) is unchanged while the wallet's USDC balance on Base is +5; retrying with the same header returns 400 `settlement reverted`; a fresh signature charges B another 5 USDC.

### 5. Medium: safeFetch validates the hostname once with dns.lookup, then fetch() resolves it again: DNS rebinding reaches internal services and the response is packaged into a product file

`apps/engine/src/net.ts:40`

```
    const r = await fetch(url, { ...init, redirect: "manual" });
```

publicUrl() (lines 19-32) resolves the hostname with dns.lookup and rejects private answers, but safeFetch then passes the URL object with the original hostname to fetch() (line 40), and undici performs its own, second DNS resolution for the connection. A hostname whose authoritative server alternates answers with TTL 0 (first a public IP, then 127.0.0.1 / 172.18.x / 169.254.169.254) passes the check on the first lookup and connects to the private address on the second. Only ports 80 and 443 are allowed, which still covers http://169.254.169.254/ (cloud metadata; DEPLOY.md targets a cloud VM), the host's port 80/443 and every neighbour on the Docker network. The URLs reaching safeFetch are third-party data: fetchDelivery() (products.ts:101-113) takes `files[...]` and `repoUrl` from the IMD job result produced by the swarm's agents, and checkLinks() (products.ts:83-95) takes every http(s) URL in LLM and swarm text. fetchDelivery returns the fetched body, which #package writes into the private product file (products.ts:52) that the owner downloads and buyers receive, so the response of the internal request is exfiltrated; checkLinks is a blind GET with side effects. privateIp also omits 192.0.0.0/24 and 198.18.0.0/15 and IPv4-mapped addresses inside brackets. Fix: connect to the address that was vetted. With undici: `new Agent({ connect: { lookup: (h, o, cb) => cb(null, [{ address: vetted, family }]) } })` passed as `dispatcher`, keeping the Host header and SNI from the URL, and re-apply the pinning on every redirect hop; extend privateIp with the missing ranges.

**Reproduction**

State: a live company whose task result from the swarm is `{ files: { "guide.md": "http://rebind.example.net/latest/meta-data/iam/security-credentials/role" } }`, where rebind.example.net answers 93.184.216.34 on the first query and 169.254.169.254 on the next (TTL 0). Steps: the 4-second tick calls files.ensure -> fetchDelivery -> safeFetch(u). publicUrl(): lookup returns 93.184.216.34 -> allowed. fetch(url) at line 40 resolves again, gets 169.254.169.254, connects on port 80 and returns the metadata body. Expected: the request is refused or made only to the vetted address 93.184.216.34. Actual: the metadata response is returned, prefixed with the product head and written to data/products/<id>.md, downloadable through /api/companies/:id/products/:pid/download and every signed sale link.

### 6. Medium: CEO reprice has no price floor or ceiling: a product can be repriced to 1 micro-USDC, or to a negative amount that a 0-value authorization satisfies

`packages/core/src/shift.ts:301`

```
      p.priceUsdc = usdc(decision.priceUsd);
```

llmDecision clamps the model's price only for build_product (planner.ts:142: Math.min(499, Math.max(1, ...))) and the owner's setPrice is bounded to USD 0.50-500 (engine.ts:769), but a reprice decision's top-level priceUsd is applied as-is in doInHouse (line 301). The only check is truthiness at line 299. Any positive value above 5e-7 survives usdc() (types.ts:104, BigInt(Math.round(x*1e6))), so 0.000001 makes priceUsdc = 1n and the x402 requirement amount '1': every buyer gets the product for one micro-USDC. A negative value makes priceUsdc negative: requirement() emits a negative amount string, verifyPayment's `BigInt(a.value) < BigInt(req.amount)` passes for a value of 0, the balance check `bal < value` passes with 0, settlePayment submits a 0-value transferWithAuthorization (the company pays gas), and recordSale throws inside ledger validate (zero posting) after p.sales was already incremented. A non-finite value (priceUsd 1e400 from JSON.parse) makes BigInt() throw and aborts the shift. Reachable in normal operation: the system prompt tells the model reprice is a free move, and the model is fed back product names and pitches it generated. Fix: clamp d.priceUsd in llmDecision the same way as d.product.priceUsd (and reject non-finite), have doInHouse refuse priceUsd outside [0.5, 500] as setPrice does, and make requirement() reject amount <= 0.

**Reproduction**

Input: the CEO model returns {"kind":"reprice","title":"x","why":"y","productId":"<live product id>","priceUsd":0.000001}. runShift -> doInHouse: usdc(0.000001) = 1n; p.priceUsdc = 1n; the journal says 'price $9.00 -> $0.00'. GET /buy/<slug>/<id> now answers 402 with accepts[0].amount = "1". A buyer signs an EIP-3009 authorization for value 1: verifyPayment ok, settlement transfers 1 micro-USDC, recordSale posts 1n, deliverable link returned. Expected: a reprice is held to the same bounds as every other price (>= USD 0.50). Actual: the product is given away for 1 micro-USDC; with priceUsd -5 the amount is "-5000000" and a 0-value authorization passes verification.

### 7. Medium: The /setup change alert omits PLATFORM_DEV and the Telegram alert settings, so a leaked admin token can redirect the dev fee or silence the alert channel without the announced warning

`apps/engine/src/server.ts:259`

```
          const touched = ["NIGHTSHIFT_MODE", "PLATFORM_TREASURY", "PLATFORM_FEE_BPS", "ETH_RPC", "SALES_RPC", "SALES_CHAIN_ID", "TOKEN_ADDRESS", "NFT_ADDRESS", "REQUIRE_AUTH"].filter((k) => k in patch);
```

The comment on line 258 states the control: settings that move money or trust are announced so that a leaked admin token cannot act quietly. The `touched` list omits PLATFORM_DEV, which receives 20% of every platform fee in Engine.#withdraw (engine.ts:919-920, 933), and omits TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS and LAUNCH_NOTIFY, which decide where every alert and admin card goes and who may run bot commands. All are in EDITABLE (settings.ts:9-19), saveSetup validates PLATFORM_DEV only with isAddress, and POST /api/admin/restart (line 349) applies them. An attacker holding the admin token can change PLATFORM_DEV and collect the dev share of every withdrawal with no message to the operator, or first point TELEGRAM_CHAT_ID at a chat they control so that the alerts for the announced keys reach only them. Fix: add PLATFORM_DEV, TELEGRAM_CHAT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS and LAUNCH_NOTIFY to `touched`, send the alert before writeSettings and to the chat configured before the change, and alert on /api/admin/restart as well.

**Reproduction**

Input: `curl -X POST https://host/api/admin/setup -H 'x-admin-token: <leaked>' -H 'Content-Type: application/json' -d '{"PLATFORM_DEV":"0x1111111111111111111111111111111111111111"}'` then `curl -X POST https://host/api/admin/restart -H 'x-admin-token: <leaked>'`. Expected: an operator alert naming PLATFORM_DEV, as for PLATFORM_TREASURY. Actual: 200 with the new setup state and no engine.alert call (`touched` is empty because 'PLATFORM_DEV' is not in the list); after the restart, the next owner withdrawal of $100 with PLATFORM_FEE_BPS=500 sends the $1 dev part to the attacker's address and the operator's Telegram is silent. Same for `{"TELEGRAM_CHAT_ID":"<attacker chat>"}`: no alert, and after restart every later alert, including the ones for the announced keys, goes to the attacker.

### 8. Low: POST /api/keys has no rate limit and no per-owner cap: any signed-in wallet grows state.json without bound and makes every nsk_ lookup a linear scan

`apps/engine/src/server.ts:471`

```
        if (req.method === "POST") { const b = await body(req); return json(res, 201, engine.auth.createKey(owner, String(b.label ?? "MCP"))); }
```

Sign-in is free (any wallet signs a nonce). Every other write route is wrapped in limited(...), but the /api/keys POST at line 471 is not, and Auth.createKey (auth.ts:95-101) pushes a record into store.apiKeys with no ceiling per owner or in total. store.apiKeys is persisted in the single state.json snapshot that Store.flush() re-serialises in full every 3 seconds whenever anything is dirty (store.ts:61-74), and the engine marks the store dirty on every emit. Auth.owner() (auth.ts:85-90) resolves an nsk_ bearer with `this.keys.find(...)`, so every /mcp request with any nsk_-prefixed token walks the whole array. One wallet can turn a free sign-in into unbounded disk growth and CPU on the server that also holds the company wallets. Fix: wrap the route with `limited(req, "keys", 10, 3600_000)`, refuse createKey when the owner already holds a reasonable number of keys (for example 20), and index keys by hash in a Map.

**Reproduction**

Input: sign in once with any wallet (GET /api/auth/nonce, POST /api/auth/verify), then `for i in $(seq 1 200000); do curl -s -b 'ns_session=<token>' -H 'Content-Type: application/json' -d '{"label":"x"}' -X POST https://host/api/keys; done`. Expected: a 429 after a few dozen calls, or a 400 once the wallet holds a reasonable number of keys. Actual: every call returns 201; GET /api/keys returns 200,000 entries; data/state.json grows by about 150 bytes per key and is rewritten every 3 seconds; `curl -H 'Authorization: Bearer nsk_zzz' https://host/mcp` scans 200,000 hashes before answering 401.

### 9. Low: Live-readiness treats a generated vault secret as a warning, so /setup reports 'ready for live' while every company key is recoverable from the data volume alone

`apps/engine/src/admin.ts:57`

```
    { id: "secret", label: "Wallet vault key", state: process.env.NIGHTSHIFT_SECRET ? "ok" : "warn",
```

Vault (vault.ts:25-30) writes secret.key next to vault.json when NIGHTSHIFT_SECRET is unset; the AES-GCM layer then protects nothing against anyone who obtains the data volume (backup, snapshot, misconfigured mount), since the key sits beside the ciphertext. The same secret derives the session MAC key (auth.ts:24) and the download-link key (products.ts:22), so possession of the volume also forges owner sessions for every wallet. The code comment in vault.ts calls this 'wrong for production', yet setupState marks it 'warn' at line 57, and readyForLive (line 75) only considers 'block' states, so the dashboard shows a green 'ready for live' with real funds while the vault key is unprotected. The 'auth' and 'url' checks, by contrast, escalate to 'block' in live mode. Fix: `state: process.env.NIGHTSHIFT_SECRET ? "ok" : live ? "block" : "warn"`, and refuse to start in live mode when vault.generatedSecret is true.

**Reproduction**

State: container started with NIGHTSHIFT_MODE=live and no NIGHTSHIFT_SECRET (docker-compose.yml and the Dockerfile set neither). Input: `curl -H 'x-admin-token: <token>' https://host/api/admin/setup`. Expected: checks[secret].state == "block" and readyForLive == false until NIGHTSHIFT_SECRET is set. Actual: checks[secret].state == "warn" and readyForLive == true. Anyone who copies /data can run `scryptSync(readFileSync('secret.key','utf8').trim(), 'nightshift-vault-v1', 32)` and decrypt every entry of vault.json (keeper and all company wallets), and mint `s.<owner>.<exp>.<hmac>` sessions for any owner.

### 10. Low: Space Pinball replay only bounds the last input tick to wall-clock: the seed is known up front, so a client can search for optimal inputs with the shipped engine and the server certifies the result as

`apps/engine/src/pinball.ts:142`

```
  if (Date.now() - m.startedAt < (lastTick / 240) * 1000 - 3_000) throw new Error("inputs from later than the match has run");
```

soloStart (lines 188-194) returns the seed immediately and duel view() (line 66) reveals it 400 ms before startedAt. The engine is deterministic and shipped byte-identical to the browser (apps/web/src/pinball/engine.ts). The only anti-cheat in finish() (line 142) and soloFinish() (line 200) is that the largest input tick is not ahead of wall-clock time minus 3 s before the server replays. Nothing ties an input to the moment it was pressed: a client can run replay(seed, candidates) locally thousands of times during the match (beam search a few hundred ticks ahead, committing the best branch only after its wall-clock time has passed), submit the best input list, and the server's own replay confirms it. In duels view() also exposes each player's `solo` score and `finished` flag (line 67) before settle, so the second finisher knows the target. The result is recorded on the persisted boards, and engine.ts:159 and :166 post 'NEW ALL-TIME ... RECORD ... Verified by replay' to the community chat. Severity is low today because STAKES_LIVE is false (line 31); the same code path will arbitrate IMD/SHIFT stakes when the escrow goes live. Fix before enabling stakes: require inputs to be streamed via progress() with a hash of each 1-second input window committed before the window's wall-clock time ends and have finish() verify the submitted inputs against those commitments; hide opponents' interim scores until both have finished; at minimum drop the words 'Verified by replay' from the record posts.

**Reproduction**

Input: `POST /api/pinball/solo {"name":"bot"}` -> `{id, seed}`. Locally (node, with the shipped engine.ts): `let best=null; for (let n=0;n<20000;n++){ const inputs = random flipper taps at random ticks within 0..elapsed*240; const s=replay(seed,inputs).score; if(!best||s>best.score) best={score:s,inputs}; }`; sleep `maxTick / 240` seconds; `POST /api/pinball/solo/<id>/finish {"inputs": best.inputs}`. Expected: a score a human could not reach in one real-time attempt is rejected. Actual: 200 with the search-optimised score; it tops /api/pinball/board and, if it beats the record, a 'verified by replay' record card is posted to Telegram. In a duel, GET /api/pinball/match/<id>?player=<me> after the opponent finished shows their `solo` score before you finish.

### 11. Low: A 200 KB data: avatar is relayed to every match listener on each progress POST: one player can push about 120 MB a minute through the server to their opponent and spectators

`apps/engine/src/pinball.ts:82`

```
  const face = avatar && (/^\/games\/pinball\/frog-\d\.webp$/.test(avatar) || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]{100,200000}$/.test(avatar)) ? avatar : null;
```

queue() accepts a data:image/svg+xml;base64 avatar of up to 200,000 characters per player (line 82) and never checks that it decodes to an SVG. view() (lines 65-68) includes `avatar` for both players in every event, and progress() (lines 111-123) calls emit(m) on each POST, which writes the full view to every SSE listener of the match (server.ts:400). The progress route allows 600 POSTs a minute per IP (server.ts:406), so a single player with a maximal avatar makes the server send up to 600 x 200 KB = 120 MB a minute to the opponent and to every spectator stream of that match, from the server's own uplink. Fix: send the avatar once in the first event or as a separate field fetched by id, cap data: avatars at a few KB (an onchain frog SVG is small), and validate that the base64 decodes to an SVG document.

**Reproduction**

Input: `POST /api/pinball/queue {"name":"a","currency":"FREE","stake":0,"avatar":"data:image/svg+xml;base64," + "A".repeat(199000)}` from one client; a second client queues normally and opens `GET /api/pinball/match/<id>/events`. Then from the first client: `for i in $(seq 1 600); do curl -s -X POST https://host/api/pinball/match/<id>/progress -H 'Content-Type: application/json' -d '{"player":"<pid>","score":1,"tick":'$i'}'; done` within a minute. Expected: progress events are small (score, tick, position, attacks). Actual: each SSE event is about 200 KB; the opponent's stream receives about 120 MB in that minute, sent once per listener.

### 12. Low: The ledger that decides withdrawable revenue lives in memory and is flushed only every 3 seconds, so a crash after an on-chain transfer re-creates already-paid revenue

`apps/engine/src/engine.ts:87`

```
    setInterval(() => void this.store.flush(), 3000);
```

The Ledger is a MemoryLedgerStore snapshotted to state.json by the 3-second timer at line 87 (store.ts:61-74). Money-moving operations (recordSale, #withdraw, closeOut) post to the ledger and return without awaiting a flush. A crash in the window between an on-chain transfer and the next flush loses the posting while the chain state is final. For a withdrawal this re-creates the already-paid amount as withdrawable after restart, which then feeds the fee-on-fee path of the withdrawal finding; for a sale it hides revenue from the owner. Fix: await store.flush() right after every ledger post that mirrors a chain transfer, or append ledger postings to a write-ahead file synchronously.

**Reproduction**

State: live mode, co:X:usdc = 50 USDC, owner withdraws all: the USDC transfer to the owner lands on Base, ledger.post(withdraw:...) runs, then the process is killed within 3 s before flush(). Restart: state.json has no withdraw entry, GET /api/companies/X returns withdrawableUsd 50 although the wallet holds 0 USDC. Expected: 0 withdrawable. The next withdraw attempt sends the fee legs first and reverts on insufficient balance, or, if a new sale brought USDC in, pays the platform fee on the phantom 50.

### 13. Low: Order failures after payment submission keep the IMD cost in the budget and the books even when IMD never charged

`packages/core/src/shift.ts:232`

```
        if (o.state === "refused" || o.state === "payment_failed" || o.state === "expired") {
```

buy() posts `imd:<orderId>` debiting co:<id>:imd by caps.price and sets costImd before IMD confirms admission (lines 166-184). When advance() later finds the order in payment_failed or expired (line 232: IMD did not take the IMD, for example the Permit2 transfer failed or the quote lapsed), it marks the task failed but neither zeroes costImd nor reverses the ledger posting. #recover (engine.ts:795) only repairs the `rejected by spendControls` case. Effects: spentTodayUsd (policy.ts:19-23) over-counts, so the company rests on budget for work it never bought; the owner dashboard's spent/profit and imdBalance misreport. Fix: on payment_failed/expired set costImd = 0n and post a reversing ledger entry (`imd-reversal:<orderId>`); on refused keep the charge only if txHash is set.

**Reproduction**

State: live company, policy dailyBudgetUsd 10, IMD at $6.87. Shift orders a 0.5 IMD job; open() submits; IMD later reports status payment_failed with no transactionHash. Expected: task failed, costImd 0, no IMD debit, budget untouched. Actual: task.costImd = 5e17, ledger co:X:imd -0.5 IMD, spentTodayUsd = 3.43 USD; two such failures plus one real order leave canSpend() returning wait:'budget' for the rest of the day though only 0.5 IMD left the wallet.

### 14. Low: Daily budget window is computed from a task list capped at 300 entries, so free moves can evict paid spend from the last 24h and reopen the budget

`packages/core/src/shift.ts:99`

```
  if (c.tasks.length > 300) c.tasks.splice(0, c.tasks.length - 300);
```

spentTodayUsd (policy.ts:19-23) sums costImd over c.tasks with updatedAt in the last 24h, and canSpend/budgetFreesAt trust that sum. runShift pushes a task for every move, free or paid, and line 99 trims the array to the newest 300 before buying. Free moves (marketing, reprice, retire_product) are not rate-limited by the saver, do not set restUntil, and a company may run a shift every minute (shiftMinutes >= 1 in validatePolicy). Once 300 free tasks have been appended after the day's paid ones, the paid tasks fall out of the array, spentTodayUsd returns 0, and the next paid order is allowed although the daily budget was already spent. Preconditions: the LLM CEO keeps choosing free moves (the playbook planner spaces marketing 20h apart, so this needs the model path) and shiftMinutes small. Fix: keep spend accounting separate from the task list (c.spend: {at, imd}[] pruned by age, not count), or never evict tasks younger than 24h with costImd > 0.

**Reproduction**

State: dailyBudgetUsd 10, imdUsd 6.87, job price 0.5 IMD (USD 3.44), shiftMinutes 1, autopilot on, LLM CEO. 00:00 two paid orders land (spent USD 6.87). From 00:02 the model answers reprice/marketing every shift (free). After 300 free shifts (about 5 hours) c.tasks holds only those 300; the two paid tasks are gone. 05:02 the model picks research: spentTodayUsd = 0, canSpend allows, the company buys a third and a fourth 0.5 IMD job the same day (USD 13.74 > USD 10). Expected: at most USD 10 of IMD per rolling 24h. Actual: the budget resets every 300 shifts.

### 15. Low: Product ids are 8 hex characters with no uniqueness check, and both the packaged file path and the download signature key on the id alone

`apps/engine/src/products.ts:25`

```
  #file(p: Product) { return join(this.#dir, `${p.id.replace(/[^a-zA-Z0-9-]/g, "")}.md`); }
```

packages/core/src/shift.ts:117 creates product ids as randomUUID().slice(0, 8) (32 bits) and never checks them against existing products of other companies. ProductFiles.#file (line 25) stores the private deliverable as <dataDir>/products/<id>.md, has()/read() look it up by id only, and #sig() (line 41) signs `${id}|${exp}|${ref}` without the company. When two products in different companies share an id: ensure() for the second returns early because has(p) is already true, so the second company sells the first company's file; a download link bought for one is valid at /download/<otherSlug>/<id>/<exp>/<sig> for the other; and market() lists the second product as packaged although its own delivery was never fetched. The birthday bound makes this unlikely at hundreds of products, but it is a silent correctness failure that leaks one company's paid content to another company's buyers. Fix: use the full UUID (or 16+ hex chars) and reject collisions across all companies at creation; key the file path and the HMAC on `${companyId}/${productId}`.

**Reproduction**

State: company A has product `p` with id 1a2b3c4d, packaged. Input: company B's shift creates a product whose randomUUID().slice(0, 8) is also 1a2b3c4d (reproduce by stubbing randomUUID or by editing state.json). Expected: B's product gets its own file and its own signed links. Actual: files.has(B.p) is true immediately, B's product is listed as for sale, a buyer of B's product downloads products/1a2b3c4d.md which is A's deliverable, and A's buyer link also opens under B's slug.

### 16. Low: Spending budgets are converted with an unauthenticated DexScreener price bounded only to [0.01, 10000] USD per IMD, so a wrong feed value lets a company spend far past the owner's USD limit

`apps/engine/src/engine.ts:592`

```
    const keep = (price: number) => { if (price > 0.01 && price < 10_000) { config.imdUsd = price; config.imdUsdAt = Date.now(); return true; } return false; };
```

Every owner limit (dailyBudgetUsd, approvalOverUsd) is enforced by canSpend in USD, but the IMD cost is valued at config.imdUsd, which #refreshImdPrice overwrites every 10 minutes from api.dexscreener.com (pair sorted by reported liquidity), falling back to GeckoTerminal. The only sanity check is the 0.01..10000 range at line 592. A wrong or manipulated feed (a stale pair, a bad priceUsd string, a new high-liquidity pair showing a dumped price, or a substituted upstream response) that reports e.g. $0.02 lets a company with a $10 daily budget and $5 ask-over spend 500 IMD (about $3,400 at the pinned default of $6.87) in a day without ever asking the owner, since 0.5 IMD then 'costs' $0.01. Fix: enforce the budget in IMD as well (store the price used at policy time and cap daily IMD spend at dailyBudgetUsd / max(priceAtPolicy, livePrice)), reject feed values that move more than about 30% from the last kept value without a second source agreeing, and show the price actually used in the approval card.

**Reproduction**

State: live company with policy {dailyBudgetUsd: 10, approvalOverUsd: 5}, wallet holding 50 IMD. Input: the DexScreener response for IMD lists a pair with liquidity.usd above the real pool and priceUsd "0.02" (or the real pool briefly prints that). Expected: the company still cannot spend more than about 1.5 IMD (= $10) in a day and asks before anything over $5. Actual: after the next refresh config.imdUsd = 0.02; each 0.5 IMD order is valued at $0.01, canSpend allows up to 500 IMD/day with no approval request, and the wallet is drained by the next shifts.

### 17. Low: Keeper falls back to the splitter's whole ETH balance as the burn amount whenever the reserve() read fails for any reason, including a transient RPC error

`apps/engine/src/keeper.ts:107`

```
  const reserve = await eth.readContract({ address: splitter, abi: SPLITTER, functionName: "reserve", args: [ETH] }).catch(() => bal(ETH));
```

The `.catch(() => bal(ETH))` at line 107 is meant for a splitter without a reserve(token) view, but it also fires on a transient RPC error. In that case `reserve` becomes the splitter's entire ETH balance, which after a skipped-for-dust distribute (balance below 0.005 ETH, line 102) or fees that arrived between distribute and this read includes ETH that belongs to rewards, dev and treasury. burnReserve(ETH, amountIn, minOut) is then simulated and sent with that amountIn. Whether anything is lost depends on the splitter contract (not in this repository) enforcing amountIn <= reserve; if it does, the run just logs a revert, if it does not, undistributed ETH is bought as IMD and burned. Fix: distinguish 'function missing' (revert data / ABI decoding error) from transport errors, and only fall back on the former; otherwise skip the burn for this run.

**Reproduction**

Keeper run where distribute(ETH) is skipped (splitter holds 0.004 ETH < DUST.eth) and the reserve() RPC call rejects with an HTTP/timeout error. Expected: 'burn: reserve unknown' and no burn. Actual: reserve = 0.004 ETH (the whole balance), quoted via the Quoter, and burnReserve(ETH, 4e15, minOut) is submitted; the outcome depends on the splitter's internal check.

### 18. Low: Post-deploy token check is a five-selector denylist and passes a token with any other privileged function

`apps/engine/src/shift-verify.ts:17`

```
const FORBIDDEN: Record<string, string> = { "40c10f19": "mint(address,uint256)", "a0712d68": "mint(uint256)", "8456cb59": "pause()", "f9f92be4": "blacklist(address)", "69fe0e2d": "setFee(uint256)" };
```

verifyShift is the gate before the treasury makes the first buy and before the engine, bot and site switch to the deployed token. Its 'no mint, pause, blacklist or fee switch' check (line 39-40) only searches the runtime bytecode for the five exact 4-byte selectors in FORBIDDEN. A token exposing the same powers under another signature (mintTo(address,uint256) 0x449a52f8, mint(address,uint256,bytes), setTaxes(uint256,uint256), setBlacklisted(address,bool), freeze(address), setMaxTx(uint256)) or an owner-only transfer hook passes with 'none found', and the other token checks (name/symbol/supply/dev balance) do not look at code at all. The splitter and rewards checks likewise accept any contract whose bytecode merely contains the dev, treasury and burn addresses as constants (has()), which a contract can satisfy while routing funds elsewhere. The UI tells the operator 'Everything matches' and shows the first-buy button on this basis. Fix: verify against the source IMD publishes for the launch (compile and compare runtime bytecode, or compare the full selector set against the spec's allowed interface), and for the splitter simulate distribute() with a state override and check the four recipient balances move by 40/20/20/20.

**Reproduction**

Deploy (or model) an ERC-20 named NIGHTSHIFT/SHIFT, 1e27 supply, 18 decimals, with `function mintTo(address,uint256) onlyOwner` and `function setTaxes(uint256,uint256) onlyOwner`, and point launchState().contracts.token at it. Run POST /api/admin/token/verify. Expected: 'Token has no mint, pause, blacklist or fee switch' fails. Actual: it reports ok with detail 'none found' because neither 0x449a52f8 nor the setTaxes selector is in FORBIDDEN; with the other checks green the launch card says 'Everything matches' and the first-buy button is shown.

### 19. Low: Swap sell path grants the Universal Router a maximum, never-expiring Permit2 allowance

`apps/web/src/SwapPage.tsx:97`

```
          const h = await w.writeContract({ account: a, chain: mainnet, address: V4.permit2, abi: permit2Abi, functionName: "approve", args: [token, V4.router, maxUint160, 2 ** 48 - 1] });
```

The first sell approves maxUint256 SHIFT to Permit2 (line 91, standard) and then at line 97 a Permit2 allowance of maxUint160 to the router with expiration 2^48-1. Uniswap's own interface uses a 30-day expiration for the router allowance; the point of Permit2 expirations is to bound exposure if a router is ever compromised or deprecated. Users who sell once through the site keep an unbounded, permanent standing permission for the router to pull all their SHIFT. Fix: use `amt` or a 30-day expiration (`Math.floor(Date.now()/1000) + 30*86400`), as Uniswap does, re-approving when expired.

**Reproduction**

Connect a wallet holding SHIFT, choose Sell, enter any amount, confirm the two approvals. Read Permit2.allowance(user, SHIFT, V4.router): expected a bounded amount or a 30-day expiration; actual (2^160-1, 281474976710655).

### 20. Info: Unused DexScreener price helper in the keeper reads an off-chain, manipulable price

`apps/engine/src/keeper.ts:43`

```
async function ethPerImd(): Promise<number> {
```

ethPerImd() fetches an IMD/ETH price from DexScreener but is never called; the burn's minimum comes from the on-chain Quoter (line 110). Dead code that reads an external price API is a maintenance trap: a future edit could wire an off-chain price into minOut. Remove it, or use it only as a sanity bound against the Quoter.

**Reproduction**

`grep -n ethPerImd apps/engine/src/*.ts` shows only the definition at keeper.ts:43 and no call site.

---

Judge's submission `7dfe802ea7f629c482f55150161ae960d385f5a22222ea92b1a4c20c66b4936e`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
