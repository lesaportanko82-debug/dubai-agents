import { NextResponse } from 'next/server';
import { panelContext } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';
import { impactMetrics } from '@core/domovoy/metrics';
import { learningReport } from '@core/domovoy/learning';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/domovoy/metrics?days=7 — impact numbers for the household of the current panel session (demo otherwise). */
export async function GET(req: Request) {
  loadRootEnv();
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 7) || 7));
  const { store, isDemo } = await panelContext();
  const now = new Date().toISOString();
  const [metrics, learning] = await Promise.all([impactMetrics(store, now, days), learningReport(store, 'en')]);
  return NextResponse.json({ ok: true, demo: isDemo, metrics, learning: learning.rows, approvals: await store.approvals({ limit: 20 }) });
}
