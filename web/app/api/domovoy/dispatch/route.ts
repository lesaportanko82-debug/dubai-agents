import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { panelContext, demoNow, domovoyState, getDomovoyDb } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { runDispatch } from '@core/domovoy/agent';
import { getModelClient } from '@core/owed/llm';
import { flushOutbox, telegramSender } from '@core/domovoy/telegram';

export const dynamic = 'force-dynamic';

/** POST { text, authorId } — run the agent for the household of the current panel session (demo family when not logged in). */
export async function POST(req: Request) {
  loadRootEnv();
  const { text, authorId } = (await req.json()) as { text?: string; authorId?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'No model key configured on the server' }, { status: 500 });
  const ctx = await panelContext();
  const store = ctx.store;
  const members = await store.members();
  const author = members.find(m => m.id === authorId) ?? ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  const before = (await store.outbox()).length;
  try {
    const result = await runDispatch(await getModelClient(), store, author.id, text, { now: demoNow(), tz: store.tz, mode: store.mode });
    const messages = (await store.outbox()).slice(before);
    const rec = { id: randomUUID(), at: new Date().toISOString(), authorId: author.id, input: text, result, messages };
    if (getDomovoyDb()) {
      await store.saveRun({ id: rec.id, at: rec.at, authorId: rec.authorId, input: rec.input, result: { summary: result.summary, tasks: result.tasks, trace: result.trace, redactions: result.redactions } });
      // linked Telegram chats (a real family) get their messages right away
      const tok = process.env.DOMOVOY_TELEGRAM_TOKEN?.trim();
      if (tok) await flushOutbox(store, telegramSender(tok)).catch(() => undefined);
    } else {
      domovoyState().runs.unshift(rec as any);
    }
    return NextResponse.json(rec);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
