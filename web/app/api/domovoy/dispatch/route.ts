import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { domovoyState, demoNow } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { runDispatch } from '@core/domovoy/agent';
import { getModelClient } from '@core/owed/llm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  loadRootEnv();
  const { text, authorId } = (await req.json()) as { text?: string; authorId?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'No model key configured on the server' }, { status: 500 });
  const state = domovoyState();
  const before = (await state.store.outbox()).length;
  try {
    const result = await runDispatch(await getModelClient(), state.store, authorId ?? 'mum', text, { now: demoNow() });
    const messages = (await state.store.outbox()).slice(before);
    const rec = { id: randomUUID(), at: new Date().toISOString(), authorId: authorId ?? 'mum', input: text, result, messages };
    state.runs.unshift(rec as any);
    return NextResponse.json(rec);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
