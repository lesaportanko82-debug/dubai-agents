import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { owedContext, saveRun } from '@/lib/owed-server';
import { loadRootEnv } from '@/lib/env';
import { runIntake } from '@core/owed/agent';
import { getModelClient } from '@core/owed/llm';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  loadRootEnv();
  const { text, channel } = (await req.json()) as { text?: string; channel?: string };
  if (!text?.trim()) return NextResponse.json({ error: 'empty' }, { status: 400 });
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'No model key configured on the server' }, { status: 500 });
  }
  const state = await owedContext();
  try {
    const ch = ['marketplace', 'telegram', 'email', 'service_act'].includes(channel ?? '') ? channel! : 'telegram';
    const result = await runIntake(await getModelClient(), state.store, text, { channel: ch });
    const rec = { id: randomUUID(), at: new Date().toISOString(), input: text, channel: ch, result };
    await saveRun(rec);
    return NextResponse.json(rec);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json((await owedContext()).runs.slice(0, 20));
}

export const maxDuration = 60;
