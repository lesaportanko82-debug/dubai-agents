import type { Member } from '@core/domovoy/types';

export const ROLE_LABEL: Record<string, { ru: string; en: string }> = {
  adult: { ru: 'взрослый', en: 'adult' },
  child: { ru: 'ребёнок', en: 'child' },
  elder: { ru: 'старшее поколение', en: 'elder' },
  helper: { ru: 'помощница по дому', en: 'domestic helper' },
};
export const LANG_LABEL: Record<string, string> = { ru: 'русский', en: 'English', tl: 'Tagalog', ar: 'العربية', tr: 'Türkçe', hi: 'हिन्दी' };
/** «Семейный круг» palette: each person recognisable, all of them together one circle (white text passes 4.5:1 on each). */
export const FAMILY_PALETTE = ['#C4622A', '#2F6F8F', '#3F7A3D', '#B0456A', '#7656AE', '#8A6A1E', '#1F6F6A', '#9A4B2E'];
const KNOWN: Record<string, number> = { mum: 0, dad: 1, son: 2, masha: 3, joy: 4, granny: 5 };
function colorFor(id: string): string {
  const base = id.replace(/^demo_/, '');
  if (base in KNOWN) return FAMILY_PALETTE[KNOWN[base]];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FAMILY_PALETTE[h % FAMILY_PALETTE.length];
}

export function Avatar({ m, size = 36 }: { m: Member; size?: number }) {
  const initials = m.name.replace(/^Бабушка\s+/, '').slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0" style={{ width: size, height: size, background: colorFor(m.id), fontSize: size * 0.42 }} aria-hidden>
      {initials}
    </span>
  );
}
export const memberColor = (id: string) => colorFor(id);
