import { blueskyPost, kb, tgResult } from "../social.js";
import { type BlueskyAdapter, type GithubAdapter, SendUnknown, type TelegramAdapter } from "./recruiter.js";

/**
 * The project's GitHub bot account (a classic token with the public_repo scope, on an account of its
 * own). The token is read on every call, so one added in /setup works after a restart, and it only
 * ever goes into the Authorization header. A 401, 403 or 429 is a refusal of the account itself: the
 * error carries `stop` and the recruiter turns the channel off.
 */
export function githubChannel(token: () => string): GithubAdapter {
  const api = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<Response> => {
    const t = token();
    return fetch(`https://api.github.com${path}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/vnd.github+json", "user-agent": "nightshift-recruiter", "x-github-api-version": "2022-11-28", ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };
  const repoPath = (full: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(full) || full.includes("..")) throw new Error("not a plain repository name");
    return `/repos/${full}`;
  };
  const refused = async (r: Response, what: string) => {
    const j = (await r.json().catch(() => null)) as { message?: unknown } | null;
    const e = new Error(`GitHub ${what}: ${r.status} ${String(j?.message ?? "").slice(0, 160)}`);
    if (r.status === 401 || r.status === 403 || r.status === 429) Object.assign(e, { stop: true });
    return e;
  };
  return {
    ready: () => Boolean(token()),
    async repo(full) {
      const r = await api("GET", repoPath(full));
      if (r.status === 404 || r.status === 451) return null;
      if (!r.ok) throw await refused(r, "repository");
      const j = (await r.json()) as { has_issues?: boolean; archived?: boolean; disabled?: boolean; stargazers_count?: number };
      return { issues: j.has_issues === true, archived: j.archived === true || j.disabled === true, stars: Number(j.stargazers_count) || 0 };
    },
    async open(full, title, body) {
      const path = `${repoPath(full)}/issues`;
      let r: Response;
      // no answer at all: GitHub may have opened it, so it is never opened again
      try { r = await api("POST", path, { title, body }); } catch { throw new SendUnknown("GitHub gave no answer"); }
      if (r.status !== 201) throw await refused(r, "issue");
      const j = (await r.json().catch(() => null)) as { number?: unknown; html_url?: unknown } | null;
      if (typeof j?.number !== "number") throw new SendUnknown("GitHub answered without the issue number");
      return { id: `${full}#${j.number}`, url: String(j.html_url ?? "") };
    },
    async issue(full, number) {
      const r = await api("GET", `${repoPath(full)}/issues/${number}`);
      if (r.status === 404 || r.status === 410) return null;
      if (!r.ok) throw await refused(r, "issue");
      const j = (await r.json()) as { state?: string; comments?: number };
      return { open: j.state === "open", comments: Number(j.comments) || 0 };
    },
    async close(full, number) {
      const r = await api("PATCH", `${repoPath(full)}/issues/${number}`, { state: "closed", state_reason: "not_planned" });
      return r.ok;
    },
  };
}

/**
 * Ready-made channel adapters for the engine to pass to the recruiter. Each one talks to one fixed
 * destination chosen by the engine; the recruiter can never pick a chat or an account.
 */

/**
 * A Telegram chat, sent as plain text (no HTML parse mode). `welcomesSuggestions` only for a chat
 * that publicly welcomes suggestions; the engine's own community chat is not one.
 */
export function telegramChannel(token: string, chatId: string, opts: { welcomesSuggestions?: boolean } = {}): TelegramAdapter {
  return {
    welcomesSuggestions: opts.welcomesSuggestions === true,
    async send(text, buttons) {
      const r = await tgResult<{ message_id?: number }>(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 3800), reply_markup: kb(buttons) });
      if (r.ok) return { id: String(r.result?.message_id ?? "") };
      // no answer at all (a timeout or a dropped connection): Telegram may have posted it
      if (r.code === undefined && r.description === undefined) throw new SendUnknown("Telegram gave no answer");
      throw new Error(`Telegram: ${r.description ?? r.code}`);
    },
  };
}

/** The project's Bluesky account, signed in with an app password. */
export function blueskyChannel(handle: string, appPassword: string, opts: { welcomesSuggestions?: boolean } = {}): BlueskyAdapter {
  return {
    welcomesSuggestions: opts.welcomesSuggestions === true,
    async post(text) {
      try { return { id: await blueskyPost(handle, appPassword, text) }; } catch (e) {
        // "Bluesky: …" is a clear refusal; a timeout or a dropped connection may still have posted
        if (e instanceof Error && e.message.startsWith("Bluesky: ")) throw e;
        throw new SendUnknown("Bluesky gave no answer");
      }
    },
  };
}
