/** Code-generated candidate reasons are English keys; translate for the RU interface. */
const RU: Record<string, string> = {
  'did less this week': 'на этой неделе делал(а) меньше',
  'already did a lot this week': 'на этой неделе уже много сделал(а)',
  'free today': 'сегодня свободен(на)',
  'author of the task': 'автор дела',
  'good chore for a child': 'подходящее дело для ребёнка',
  'long task for an elder': 'долгое дело для старшего',
  'household chore within working hours': 'домашнее дело в рабочие часы',
  'family errand, helper as backup': 'семейное поручение, помощница как запасной вариант',
  'free at 17:00, did less this week': 'свободен в 17:00, на этой неделе делал меньше',
  'good chore for a child, free today': 'подходящее дело для ребёнка, сегодня свободен',
  'already declined': 'уже отказался(лась)',
  'the task is about this person': 'дело про этого человека',
  'declined earlier this week, their turn': 'на этой неделе отказывался(лась), теперь его/её очередь',
  'no reply': 'нет ответа',
  'urgent, no confirmation': 'срочное, без подтверждения',
  'not a task for a child': 'не детское дело',
  'too long for a child': 'слишком долго для ребёнка',
  'helper day off': 'выходной помощницы',
  'outside helper working hours': 'вне рабочих часов помощницы',
  'missing skill': 'нет нужного навыка',
  'daily limit reached': 'лимит дел на день',
};
export function reasonText(s: string | undefined, lang: 'ru' | 'en'): string {
  if (!s) return '';
  if (lang === 'en') return s;
  return s.split(/,\s*/).map(part => {
    const key = part.replace(/^swap after \S+ declined:\s*/, '');
    const pre = part.startsWith('swap after') ? 'после отказа: ' : part.startsWith('no reply') ? 'нет ответа: ' : part.startsWith('urgent, no confirmation') ? 'срочное, без подтверждения: ' : '';
    if (part.startsWith('no reply:')) return 'нет ответа; ' + (RU[part.slice(9).trim()] ?? part.slice(9).trim());
    if (part.startsWith('urgent, no confirmation:')) return 'срочное, без подтверждения; ' + (RU[part.slice(24).trim()] ?? part.slice(24).trim());
    if (RU[part]) return RU[part];
    if (key.startsWith('too young for')) return 'слишком мал(а) для ' + key.slice(14);
    if (key.startsWith('busy:')) return 'занят(а): ' + key.slice(5).trim();
    return pre + (RU[key] ?? key);
  }).join(', ');
}
