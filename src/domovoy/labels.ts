import type { Lang, Role } from './types';
import { KID_SKILLS } from './fixtures';

/** Human labels for skills, roles, languages — shared by the bot and the panel. */
export const SKILL_LABEL: Record<string, { ru: string; en: string; tl: string }> = {
  drive: { ru: 'водит машину', en: 'drives', tl: 'nagmamaneho' },
  cook: { ru: 'готовит', en: 'cooks', tl: 'nagluluto' },
  shop: { ru: 'покупки', en: 'shopping', tl: 'pamimili' },
  homework_help: { ru: 'помогает с уроками', en: 'homework help', tl: 'tulong sa aralin' },
  water_plants: { ru: 'поливает цветы', en: 'waters plants', tl: 'pagdidilig' },
  pharmacy: { ru: 'аптека / лекарства', en: 'pharmacy', tl: 'botika' },
  repair: { ru: 'чинит', en: 'repairs', tl: 'pagkukumpuni' },
  tidy: { ru: 'уборка', en: 'tidying', tl: 'paglilinis' },
  feed_cat: { ru: 'кормит питомца', en: 'feeds the pet', tl: 'pagpapakain ng alaga' },
  laundry: { ru: 'стирка', en: 'laundry', tl: 'paglalaba' },
  pickup_walk: { ru: 'забрать пешком', en: 'walk pickup', tl: 'sundo (lakad)' },
  take_out_trash: { ru: 'выносит мусор', en: 'takes out trash', tl: 'pagtatapon ng basura' },
};
export const ALL_SKILLS = Object.keys(SKILL_LABEL);

export const ROLE_LABEL: Record<Role, { ru: string; en: string; tl: string }> = {
  adult: { ru: 'взрослый', en: 'adult', tl: 'adult' },
  child: { ru: 'ребёнок', en: 'child', tl: 'bata' },
  elder: { ru: 'бабушка / дедушка', en: 'grandparent', tl: 'lola / lolo' },
  helper: { ru: 'помощник по дому', en: 'home helper', tl: 'kasambahay' },
};

export const LANG_LABEL: Record<Lang, string> = { ru: 'Русский', en: 'English', tl: 'Tagalog', ar: 'العربية', tr: 'Türkçe', hi: 'हिन्दी' };

/** Skills that make sense to offer for a role (children: by age). */
export function skillsForRole(role: Role, age?: number): string[] {
  if (role === 'child') return ALL_SKILLS.filter(s => (age ?? 0) >= (KID_SKILLS[s] ?? 99));
  return ALL_SKILLS;
}

export const TZ_OPTIONS: { tz: string; ru: string; en: string }[] = [
  { tz: 'Asia/Dubai', ru: 'Дубай', en: 'Dubai' },
  { tz: 'Asia/Almaty', ru: 'Алматы / Астана', en: 'Almaty / Astana' },
  { tz: 'Europe/Moscow', ru: 'Москва', en: 'Moscow' },
  { tz: 'Europe/Istanbul', ru: 'Стамбул', en: 'Istanbul' },
  { tz: 'Asia/Tashkent', ru: 'Ташкент', en: 'Tashkent' },
  { tz: 'Asia/Riyadh', ru: 'Эр-Рияд / Доха', en: 'Riyadh / Doha' },
  { tz: 'Europe/London', ru: 'Лондон', en: 'London' },
  { tz: 'Europe/Berlin', ru: 'Берлин / Париж', en: 'Berlin / Paris' },
];
