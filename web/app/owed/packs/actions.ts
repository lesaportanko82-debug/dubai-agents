'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { owedState } from '@/lib/owed-server';
import { loadRootEnv } from '@/lib/env';
import { buildPack } from '@core/owed/negotiation';
import { getModelClient } from '@core/owed/llm';

export async function buildPackAction(formData: FormData) {
  loadRootEnv();
  const supplier = String(formData.get('supplier'));
  const from = String(formData.get('from'));
  const to = String(formData.get('to'));
  const { store } = owedState();
  let err = '';
  try {
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error('No model key configured (OPENAI_API_KEY / ANTHROPIC_API_KEY)');
    const pack = await buildPack(await getModelClient(), store, supplier, { from, to });
    if (!pack) err = 'No evidenced recoverable cases for this factory in the period';
  } catch (e: any) {
    err = e?.message ?? String(e);
  }
  revalidatePath('/owed', 'layout');
  redirect(err ? `/owed/packs?supplier=${supplier}&error=${encodeURIComponent(err)}` : `/owed/packs?supplier=${supplier}`);
}
