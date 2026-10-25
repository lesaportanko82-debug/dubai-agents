import type { Member } from './types';

/** Synthetic demo family in Dubai. Names and details are invented. */
export const DEMO_FAMILY: Member[] = [
  { id: 'mum', name: 'Лена', role: 'adult', lang: 'ru', skills: ['drive', 'cook', 'shop', 'homework_help', 'water_plants', 'pharmacy'], busy: [], dailyLimit: 6, isAdmin: true, messageStyle: 'direct' },
  { id: 'dad', name: 'Алексей', role: 'adult', lang: 'ru', skills: ['drive', 'shop', 'repair', 'water_plants', 'pharmacy'], busy: [], dailyLimit: 6, isAdmin: true, messageStyle: 'direct' },
  { id: 'son', name: 'Тимур', role: 'child', age: 10, lang: 'ru', skills: ['water_plants', 'tidy', 'feed_cat'], busy: [], dailyLimit: 2, messageStyle: 'quest' },
  { id: 'masha', name: 'Маша', role: 'child', age: 6, lang: 'ru', skills: ['tidy'], busy: [], dailyLimit: 1, messageStyle: 'quest' },
  { id: 'granny', name: 'Бабушка Галя', role: 'elder', lang: 'ru', skills: ['cook', 'water_plants', 'homework_help', 'pickup_walk'], busy: [], dailyLimit: 2, messageStyle: 'gentle' },
  { id: 'joy', name: 'Joy', role: 'helper', lang: 'tl', skills: ['shop', 'cook', 'tidy', 'water_plants', 'laundry', 'pickup_walk'], workHours: { from: '08:00', to: '18:00' }, dayOff: [4], busy: [], dailyLimit: 5, messageStyle: 'formal' },
];

/** Skills considered safe for children by age */
export const KID_SKILLS: Record<string, number> = { water_plants: 6, tidy: 5, feed_cat: 7, take_out_trash: 9, homework_help: 99, drive: 99, shop: 12, cook: 12, pharmacy: 99, repair: 99, laundry: 10, pickup_walk: 99 };
