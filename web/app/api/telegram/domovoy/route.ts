import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { domovoyState, getDomovoyDb } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { handleUpdate, telegramSender, tickAndFlush, flushOutbox, type TgUpdate } from '@core/domovoy/telegram';
import { tick } from '@core/domovoy/household';
import { getModelClient } from '@core/owed/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICK_EVERY_MS = 3 * 60_000;

function token() { loadRootEnv(); return process.env.DOMOVOY_TELEGRAM_TOKEN?.trim() ?? ''; }
/** Webhook secret derived from the token: nothing extra to configure. */
const secretFor = (tok: string) => createHash('sha256').update(tok).digest('hex').slice(0, 32);

// Global tick timestamp (shared across requests in the same serverless instance)
let lastTick = 0;

export async function POST(req: Request) {
  const tok = token();
  if (!tok) return NextResponse.json({ error: 'DOMOVOY_TELEGRAM_TOKEN is not set' }, { status: 500 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secretFor(tok)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const upd = (await req.json()) as TgUpdate;
  const send = telegramSender(tok);
  const db = getDomovoyDb();

  try {
    // piggy-back the scheduler on incoming traffic
    if (Date.now() - lastTick > TICK_EVERY_MS) {
      lastTick = Date.now();
      if (db) {
        // tick all households
        for (const h of await db.allHouseholds()) {
          const s = db.store(h);
          await tick(s, new Date().toISOString());
          await flushOutbox(s, send);
        }
      } else {
        await tickAndFlush(domovoyState().store, send);
      }
    }

    if (db) {
      // Multi-household: resolve chat → household via DomovoyDb
      const chatId = String(upd.message?.chat.id ?? upd.callback_query?.message?.chat.id ?? upd.callback_query?.from.id ?? '');
      if (!chatId) return NextResponse.json({ ok: true });

      // Idempotent check
      if (await db.seen(upd.update_id)) return NextResponse.json({ ok: true });

      // Find which household this chat belongs to
      const link = await db.memberByChat(chatId);
      if (link) {
        const store = db.store(link.household);
        await handleUpdate(store, upd, { send, model: () => getModelClient() });
      } else {
        // Unknown chat — check if there's an onboarding session
        const session = await db.session(chatId);
        if (session.householdId) {
          const h = await db.household(session.householdId);
          if (h) {
            const store = db.store(h);
            await handleUpdate(store, upd, { send, model: () => getModelClient() });
          }
        } else {
          // No household yet — for now reply with a hint (onboarding flow in Task 17)
          const text = upd.message?.text?.trim() ?? '';
          if (/^\/start/.test(text)) {
            const inviteCode = text.split(/\s+/)[1];
            if (inviteCode) {
              const h = await db.householdByInvite(inviteCode);
              if (h) {
                await db.setSession(chatId, { householdId: h.id, state: { step: 'pick_member' } });
                const store = db.store(h);
                await handleUpdate(store, upd, { send, model: () => getModelClient() });
                return NextResponse.json({ ok: true });
              }
            }
            await send.sendMessage(chatId, '👋 Привет! Попросите администратора семьи прислать вам ссылку-приглашение.\n\nHi! Ask a family admin for the invite link.');
          }
        }
      }
    } else {
      // Demo mode: single in-memory household
      const state = domovoyState();
      await handleUpdate(state.store, upd, { send, model: () => getModelClient() });
    }
  } catch (e) {
    console.error('telegram webhook', e);
  }
  return NextResponse.json({ ok: true });
}

/** GET ?setup=<secret> registers the webhook for this deployment; GET alone reports status. */
export async function GET(req: Request) {
  const tok = token();
  if (!tok) return NextResponse.json({ configured: false });
  const url = new URL(req.url);
  const setup = url.searchParams.get('setup');
  if (setup) {
    if (setup !== secretFor(tok)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    const hook = `https://${host}/api/telegram/domovoy`;
    const r = await fetch(`https://api.telegram.org/bot${tok}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: hook, secret_token: secretFor(tok), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }) }).then(x => x.json());
    return NextResponse.json({ hook, telegram: r });
  }
  const info = await fetch(`https://api.telegram.org/bot${tok}/getWebhookInfo`).then(x => x.json()).catch(() => null);
  const me = await fetch(`https://api.telegram.org/bot${tok}/getMe`).then(x => x.json()).catch(() => null);
  return NextResponse.json({ configured: true, bot: me?.result?.username, webhook: info?.result?.url, pending: info?.result?.pending_update_count, lastError: info?.result?.last_error_message });
}
