# Night Watch on a rented server (VPS)

Researched 2026-10-22. Sources were opened that day; "unverified" marks what a page did not confirm (several vendor pages blocked fetches). Prices change: re-check before quoting them on the site.

## What the bot needs

Measured locally (Node 24, one report-only pass, no keys of value): about 110 MB resident memory. Node plus viem idle at ~100-130 MB, no disk beyond ~60 MB of node_modules, almost no CPU (one HTTPS call and a few RPC reads every 15 s). `npm install` is the heaviest moment. So: 1 vCPU, 1 GB RAM, 10 GB disk, Ubuntu 24.04, public IPv4 or IPv6 outbound only (no open ports). 512 MB works only with swap; do not recommend it.

## Providers

| Provider | Smallest plan that fits | Auto-install at creation | Pays with | Referral |
|---|---|---|---|---|
| Hetzner Cloud | CX23: 2 vCPU, 4 GB, 40 GB, EUR 5.99/mo excl. VAT (hetzner.com/cloud/cost-optimized). The page showed every plan as "currently unavailable" on 2026-10-22: check stock. | Yes: "Cloud config" field on the create page, 32 KiB limit (docs.hetzner.com, creating a server) | Card, PayPal, SEPA (not opened this session, unverified); no crypto | Official referral page exists (hetzner.com/legal/referrals); amounts not shown; third parties say new user gets EUR 20 credit (unverified). Referrer needs paid history. |
| DigitalOcean | Basic droplet 1 GB / 1 vCPU, $6/mo ($4 = 512 MB, too small) (digitalocean.com/pricing/droplets) | Yes: "Additional Options > Startup scripts", accepts a cloud-config or bash (docs.digitalocean.com, provide user data) | Card, PayPal | Official, documented: new user gets $200 credit for 60 days; referrer gets $25 credit after they spend $25, no cap (docs.digitalocean.com/products/teams/how-to/refer-others). Credit, not cash. |
| Vultr | Cloud Compute ~$5-6/mo for 1 GB (pricing page blocked, unverified) | Yes: cloud-init User-Data tab and Startup Scripts (docs.vultr.com) | Card, PayPal; crypto (unverified) | Affiliate program: directories say up to $100 per referred customer who stays 30+ days (unofficial, unverified). Needs sign-up. |
| Contabo | Cloud VPS 4: 4 vCPU, 8 GB, EUR 4.40/mo on a 24-month term, EUR 5.50 otherwise (contabo.com/en/vps) | Yes: cloud-init supported (their page) | Card and others; crypto not mentioned | Not checked. Long-term contract, cheap but slower support. |
| Akash | Not tried: decentralized marketplace, pay in AKT or USDC; needs writing an SDL deployment and a wallet. Not for non-technical holders. | No cloud-init; container image only | Crypto | n/a |
| Railway | Hobby: $5/mo subscription incl. $5 usage; RAM $10/GB/mo, so the bot is ~$1-2 on top (docs.railway.com). A worker fits, but needs a GitHub-style deploy and a volume; the key would sit in service variables on Railway's platform. | Not a script | Card | Not checked |
| Render / Fly.io | Pages did not return prices (Render) or redirected (Fly). A background worker fits in principle. Same key-on-platform issue. | No | Card | Not checked |
| Crypto-paid VPS (EQVPS from $3, bit.hosting from $5, AFRICLOUD from $10, Cherry Servers hourly, randhost EUR 13.30) | Prices are vendor marketing, unverified. | cloud-init not stated by any of them | USDC/ETH | Not checked |

## Key safety model

Every path above is the same safe shape: the server creates the keeper wallet itself (`vps-setup.sh` writes a random key to `.env`, mode 600, owned by an unprivileged user) and the key is never sent anywhere. The holder funds that address with gas and, later, imdUSD; the bot signs locally. NIGHTSHIFT only sees the public keeper address and the signed pairing. The rented server's provider technically could read the disk (as with any VPS), which is why the keeper wallet must hold only working funds, never the wallet that holds the Night Watcher NFT. Railway/Render/Fly add the platform's variable store to that trust; avoid for this.

## NIGHTSHIFT-hosted seats, paid in IMD/ETH

Possible, not recommended now. NIGHTSHIFT would hold every holder's keeper key and the ETH/imdUSD in it: a single breach drains the whole crew, NIGHTSHIFT becomes a custodian (legal exposure, a promise "NIGHTSHIFT never holds your money" would be false), and the coordinator could be accused of front-running its own seats. It would need: per-seat keys in an HSM/KMS or MPC wallet with withdraw-only-to-holder rules and spend limits, audits, a terms-of-service, and a billing path (monthly IMD/ETH payment checked onchain). A middle path with no custody: a "bring your own VPS, we pay nothing" guide (this work), or an affiliate link. If demand shows, a later product could be a managed seat using a smart-account keeper with a session key limited to `barkFor`/`bite` on the vault, so a leaked key cannot withdraw funds.

## Recommendation

1. Primary: DigitalOcean $6/mo droplet (1 GB, Ubuntu 24.04) with the startup-script box: simplest console for non-technical people, card or PayPal, documented referral credit, and the new-user $200/60 days credit means the first two months are free for them.
2. Second: Hetzner CX23 at EUR 5.99/mo (cheapest per resource, good for EU holders) once stock shows; same paste-in field.
3. Keep the "my own computer" path for people with an always-on machine.

## What the owner must register (NIGHTSHIFT only earns if the owner does)

- DigitalOcean referral: create an account, get the referral link at cloud.digitalocean.com/account/referrals (credit only, $25 per referred user who spends $25).
- Hetzner referral: needs a paid account first, link in the console under Referral.
- Vultr affiliate: apply via their affiliate page (cash bounty, unverified).
- Then replace the plain provider links in `apps/web/src/WatchPage.tsx` (constant `PROVIDERS`) with the referral links, and disclose that they are referral links (the page already says so in a single line).

## Gaps

`vps-setup.sh` was syntax-checked and its logic unit-tested but not run on a real Ubuntu server (no server was bought). The first real run should be a throwaway droplet.
