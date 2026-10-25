import { NextResponse } from 'next/server';
import { domovoyState, getDomovoyDb } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { telegramSender, tickAndFlush, flushOutbox } from '@core/domovoy/telegram';
import { tick } from '@core/domovoy/household';

export const dynamic = 'force-dynamic';

/** Scheduler endpoint: called by Vercel Cron every 5 min. Protected by CRON_SECRET. */
export async function GET(req: Request) {
  loadRootEnv();

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const tok = process.env.DOMOVOY_TELEGRAM_TOKEN?.trim();
  const db = getDomovoyDb();

  if (db) {
    // Multi-household: tick every household
    const households = await db.allHouseholds();
    const send = tok ? telegramSender(tok) : undefined;
    let totalSent = 0;
    for (const h of households) {
      const store = db.store(h);
      const sent = await tick(store, new Date().toISOString());
      totalSent += sent.length;
      if (send) await flushOutbox(store, send);
    }
    return NextResponse.json({ ok: true, households: households.length, sent: totalSent, delivered: !!send });
  }

  // Demo mode
  const state = domovoyState();
  if (tok) {
    const n = await tickAndFlush(state.store, telegramSender(tok));
    return NextResponse.json({ ok: true, delivered: true, outbox: n });
  }
  const sent = await tick(state.store, new Date().toISOString());
  return NextResponse.json({ ok: true, delivered: false, sent: sent.length });
}
