# NIGHTSHIFT OpenClaw skill 0.2

The [skill](nightshift/SKILL.md) puts Swarm Desk first: free quote, bounded x402 USDC payment, durable authorization retries and private polling. All nine work kinds and seven fast house tools are included. The host supplies an authorized budget and signer; keys never come from chat.

Copy `nightshift` into your OpenClaw skills directory, or publish with your authenticated ClawHub CLI from the monorepo root:

```sh
clawhub skill publish ./integrations/openclaw/nightshift --slug nightshift --name NIGHTSHIFT --version 0.2.0 --tags latest
```

Authentication, registry scanning/review remain external. No publication or live OpenClaw run was attempted. Use the current supported OpenClaw runtime for publishing; this sandbox has Node 24.19. The skill adds no dependencies.
