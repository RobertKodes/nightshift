# NIGHTSHIFT plugin for elizaOS

Four actions on NIGHTSHIFT's free endpoints:

| Action | Triggers when the message contains | Calls |
| --- | --- | --- |
| `NIGHTSHIFT_ASK_SWARM` | a question (3+ chars) | MCP `swarm_mind_ask` |
| `NIGHTSHIFT_VERDICT_PREVIEW` | an Ethereum address | MCP `verdict_preview` (market data; the verdict itself is paid and NOT run) |
| `NIGHTSHIFT_WATCHTOWER_SAMPLE` | a contract address | `GET /api/watchtower/sample?address=` (404 until deployed) |
| `NIGHTSHIFT_BUILDCHECK_SAMPLE` | a URL | `GET /api/crews/buildcheck/sample?url=` (404 until deployed) |

No keys, no payments. Optional setting `NIGHTSHIFT_BASE_URL` (default https://getnightshift.tech).

## Use

```ts
import { nightshiftPlugin } from "@nightshift/plugin-nightshift";
// character.plugins or: new AgentRuntime({ plugins: [nightshiftPlugin] })
```

## Interface used (checked)

`Plugin`, `Action` (`name`, `similes`, `description`, `validate`, `handler`, `examples`), `Handler` returning `ActionResult {success, text, data, error}`, and `HandlerCallback`. The code is type-checked against `@elizaos/core@1.7.2` (npm `latest` on 2026-10-25), definitions read from the installed package and https://docs.elizaos.ai/plugins/reference.md.

## The client copy

`src/client.ts` is a byte copy of `integrations/nightshift-client/src/index.ts`. It is copied (not a workspace dependency) so this folder works without editing the root workspace files. If you later add this folder to the workspace, replace the copy with `import ... from "nightshift-client"`.

## Test

```bash
npm install && npm test
```

`test/plugin.test.mjs` runs all four actions with a fake runtime and fake `fetch` (no network): MCP request shape, URL extraction, callback replies, 404 handling. Result: 5 of 5 pass. NOT tested: loading the plugin inside a real running elizaOS agent.

## Registry submission (a human does this)

Per https://docs.elizaos.ai/guides/publish-a-plugin.md:

- npm package name starts with `plugin-` (the CLI adds it); this package is currently `@nightshift/plugin-nightshift`, so rename to `plugin-nightshift` or confirm scoped names are accepted.
- Real `description`; `README.md`; `src/index.ts`; built `dist/`.
- `images/logo.jpg` (400x400, max 500KB) and `images/banner.jpg` (1280x640, max 1MB): NOT created here (design assets).
- `elizaos publish --test`, then `elizaos publish`: publishes to npm, creates a GitHub repo, and opens a PR in `elizaos-plugins/registry`. Needs `npm login`, `gh auth login` (token scopes repo, read:org, workflow). Review takes about 1 to 3 business days.
- The docs require a Bun toolchain (`bun run build`) and `elizaos test`; this folder builds with plain `tsc`, which was not checked against `elizaos publish --test`.
