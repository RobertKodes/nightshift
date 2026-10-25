# NIGHTSHIFT skill for OpenClaw

`nightshift/SKILL.md` teaches an OpenClaw agent to use NIGHTSHIFT's free tools (keyless public MCP and plain HTTP) with `curl`. Free endpoints only by default. Paid calls need an explicit user budget, and the skill never signs a payment.

## Format used (checked against the docs)

Skill = a folder with `SKILL.md`: YAML frontmatter with `name` and `description` (required by OpenClaw), plus `metadata.openclaw` for gating (`requires.bins: [curl]`). Source: https://docs.openclaw.ai/tools/skills and, for ClawHub, https://raw.githubusercontent.com/openclaw/clawhub/main/docs/skill-format.md (read 2026-10-25).

## Install locally

```bash
openclaw skills install ./integrations/openclaw/nightshift --as nightshift
# or shared across workspaces:
openclaw skills install ./integrations/openclaw/nightshift --as nightshift --global
```

Or copy the `nightshift` folder into `<workspace>/skills/`. Then ask your agent "what is IMD, ask NIGHTSHIFT".

Test status: NOT run in OpenClaw. The current CLI (`openclaw@2026.10.7`) requires Node >=24.22.1 and this machine has 24.19.0, so `openclaw skills install` could not be executed. The curl commands inside the skill were run against the live site (see `examples/curl.md`). The frontmatter follows the documented format but has not been loaded by OpenClaw.

## Publish to ClawHub (a human does this)

```bash
npm i -g clawhub
clawhub login            # GitHub sign-in; `--device` on a headless machine
clawhub skill publish ./integrations/openclaw/nightshift --slug nightshift --name "NIGHTSHIFT" --version 0.1.0 --tags latest
```

Needs: a ClawHub account via GitHub OAuth, and the GitHub account must be "old enough to pass the upload gate" (the docs give no number). Published skills are licensed MIT-0 (no per-skill license override), so do not add other license terms to `SKILL.md`. ClawHub runs automated scans after publishing; held or blocked releases are visible only to the owner at `/dashboard`. Source: https://docs.openclaw.ai/clawhub and https://github.com/openclaw/clawhub.
