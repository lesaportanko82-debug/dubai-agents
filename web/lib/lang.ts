'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { Lang } from './i18n';

export async function getLang(): Promise<Lang> {
  const c = (await cookies()).get('lang')?.value;
  return c === 'en' ? 'en' : 'ru';
}

export async function toggleLang() {
  const jar = await cookies();
  const cur = jar.get('lang')?.value === 'en' ? 'en' : 'ru';
  jar.set('lang', cur === 'en' ? 'ru' : 'en', { path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}
