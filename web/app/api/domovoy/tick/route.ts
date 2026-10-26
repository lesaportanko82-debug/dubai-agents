import { NextResponse } from 'next/server';
import { domovoyState, getDomovoyDb } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { telegramSender, tickAndFlush, flushOutbox } from '@core/domovoy/telegram';
import { tick } from '@core/domovoy/household';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const now = new Date().toISOString();
    // households run in parallel; empty ones (no members) are skipped; one failure never blocks the others
    const results = await Promise.all(households.map(async h => {
      const store = db.store(h);
      try {
        if (!(await store.members()).length) return { id: h.id, skipped: true, sent: 0 };
        const sent = await tick(store, now);
        if (send) await flushOutbox(store, send);
        return { id: h.id, sent: sent.length };
      } catch (e: any) {
        console.error('tick failed for', h.id, e?.message ?? e);
        return { id: h.id, error: e?.message ?? String(e), sent: 0 };
      }
    }));
    return NextResponse.json({ ok: true, households: households.length, ticked: results.filter(r => !('skipped' in r)).length, sent: results.reduce((s, r) => s + r.sent, 0), errors: results.filter(r => 'error' in r).length, delivered: !!send });
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
