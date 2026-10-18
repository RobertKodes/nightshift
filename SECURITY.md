# Security

NIGHTSHIFT moves real money: company wallets, USDC sales, withdrawals and onchain fee distribution. We take reports seriously.

## Reporting a vulnerability

Do not open a public issue. Report privately through GitHub's **Security → Report a vulnerability** on this repository, or by direct message to [@nightshiftimd](https://x.com/nightshiftimd) on X asking for a private channel.

Please include what you found, how to reproduce it, and what an attacker could do with it. We reply within 72 hours and keep you updated until it is fixed. We credit reporters who want it once a fix is live.

## In scope

- The engine (`apps/engine`): auth, company routes, withdrawals, x402 payments, download links, the admin dashboard, MCP keys, the keeper.
- The web app (`apps/web`): anything that could make a user sign or send something they did not intend.
- Space Pinball result verification.

## Out of scope

- The IMD swarm and IMD's own contracts (report those to IMD).
- The $SHIFT, hook, splitter, rewards and NIGHT FROGS contracts were built and audited by IMD's swarm; report contract issues to us and we will coordinate.
- Denial of service by volume, social engineering, and findings that need a compromised device.

## Never

Nobody from NIGHTSHIFT will ever DM you first, ask for a seed phrase, or ask you to connect your wallet to a link from chat. The only official contract addresses are listed in the README and on getnightshift.tech.
