import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { domovoyState } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { handleUpdate, telegramSender, tickAndFlush, type TgUpdate } from '@core/domovoy/telegram';
import { getModelClient } from '@core/owed/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TICK_EVERY_MS = 3 * 60_000;

function token() { loadRootEnv(); return process.env.DOMOVOY_TELEGRAM_TOKEN?.trim() ?? ''; }
/** Webhook secret derived from the token: nothing extra to configure. */
const secretFor = (tok: string) => createHash('sha256').update(tok).digest('hex').slice(0, 32);

export async function POST(req: Request) {
  const tok = token();
  if (!tok) return NextResponse.json({ error: 'DOMOVOY_TELEGRAM_TOKEN is not set' }, { status: 500 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secretFor(tok)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const upd = (await req.json()) as TgUpdate;
  const state = domovoyState();
  const send = telegramSender(tok);
  try {
    // piggy-back the scheduler on incoming traffic (reminders, silence timeouts, urgent swaps)
    if (!state.lastTick || Date.now() - state.lastTick > TICK_EVERY_MS) { state.lastTick = Date.now(); await tickAndFlush(state.store, send); }
    await handleUpdate(state.store, upd, { send, seen: state.seenUpdates, model: () => getModelClient() });
  } catch (e) {
    console.error('telegram webhook', e);
  }
  if (state.seenUpdates.size > 1000) state.seenUpdates = new Set([...state.seenUpdates].slice(-500));
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
