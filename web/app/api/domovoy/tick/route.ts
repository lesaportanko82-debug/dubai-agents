import { NextResponse } from 'next/server';
import { domovoyState } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { telegramSender, tickAndFlush } from '@core/domovoy/telegram';
import { tick } from '@core/domovoy/household';

export const dynamic = 'force-dynamic';

/** Scheduler endpoint: call it every few minutes (external cron). Delivers to Telegram when the bot is configured. */
export async function GET() {
  loadRootEnv();
  const state = domovoyState();
  const tok = process.env.DOMOVOY_TELEGRAM_TOKEN?.trim();
  state.lastTick = Date.now();
  if (tok) { const n = await tickAndFlush(state.store, telegramSender(tok)); return NextResponse.json({ ok: true, delivered: true, outbox: n }); }
  const sent = await tick(state.store, new Date().toISOString());
  return NextResponse.json({ ok: true, delivered: false, sent: sent.length });
}
