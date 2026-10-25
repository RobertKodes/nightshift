import { blueskyPost, kb, tgResult } from "../social.js";
import { type BlueskyAdapter, SendUnknown, type TelegramAdapter } from "./recruiter.js";

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
