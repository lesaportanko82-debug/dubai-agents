import type { Member } from '@core/domovoy/types';

export const ROLE_LABEL: Record<string, { ru: string; en: string }> = {
  adult: { ru: 'взрослый', en: 'adult' },
  child: { ru: 'ребёнок', en: 'child' },
  elder: { ru: 'старшее поколение', en: 'elder' },
  helper: { ru: 'помощница по дому', en: 'domestic helper' },
};
export const LANG_LABEL: Record<string, string> = { ru: 'русский', en: 'English', tl: 'Tagalog', ar: 'العربية', tr: 'Türkçe', hi: 'हिन्दी' };
const COLORS: Record<string, string> = { mum: '#b98b1e', dad: '#1f7a6b', son: '#3b5f8a', masha: '#a8402f', granny: '#7a5c99', joy: '#2f7d4f' };

export function Avatar({ m, size = 36 }: { m: Member; size?: number }) {
  const initials = m.name.replace(/^Бабушка\s+/, '').slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0" style={{ width: size, height: size, background: COLORS[m.id] ?? '#6b7572', fontSize: size * 0.42 }} aria-hidden>
      {initials}
    </span>
  );
}
export const memberColor = (id: string) => COLORS[id] ?? '#6b7572';
