/**
 * Telegram channel for Domovoy.
 *
 * Family members talk to the bot like to a person; this module turns their messages into
 * store operations (accept / decline / done / new tasks) and delivers the agent's outgoing
 * messages back to Telegram. Everything here is transport: decisions stay in household.ts.
 *
 * Linking: a chat is linked to a family member via /start (pick yourself from a list) or a
 * deep link t.me/<bot>?start=<memberId>. Messages for members who have not linked yet are
 * echoed to the linked admins with a "→ Name:" prefix, so one parent can watch the whole flow.
 */
import type { ModelClient } from '../owed/agent';
import { runDispatch } from './agent';
import { markDone, respond, tick, weeklyReport } from './household';
import type { DomovoyStore } from './store';
import type { Lang, Member, OutgoingMessage, Task } from './types';

// ---------- Telegram shapes (only what we use) ----------
export interface TgUser { id: number; first_name?: string; language_code?: string }
export interface TgChat { id: number; type: string }
export interface TgMessage {
  message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string; caption?: string;
  photo?: { file_id: string; width: number; height: number }[];
}
export interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

export type Button = { text: string; data: string };
export interface TgSender {
  sendMessage(chatId: string, text: string, keyboard?: Button[][]): Promise<void>;
  answerCallback(id: string, text?: string): Promise<void>;
  clearKeyboard(chatId: string, messageId: number): Promise<void>;
}

export interface TelegramDeps {
  send: TgSender;
  now?: string;
  tz?: string;
  model?: () => Promise<ModelClient>;
  /** update ids already processed (Telegram retries on slow responses) */
  seen?: Set<number>;
}

// ---------- UI strings ----------
type UiLang = 'ru' | 'en' | 'tl';
const ui = (l: Lang): UiLang => (l === 'ru' || l === 'tl' ? l : 'en');
const T = {
  whoAreYou: { ru: 'Привет! Я Домовёнок — помогаю семье делить домашние дела. Кто вы в семье?', en: 'Hi! I am Domovoy, the family dispatcher. Who are you in the family?', tl: 'Hi! Ako si Domovoy, katulong ng pamilya. Sino ka sa pamilya?' },
  linked: { ru: (n: string) => `Отлично, ${n}! Теперь я буду писать вам сюда. Отвечайте просто: «ок», «не могу», «готово».`, en: (n: string) => `Great, ${n}! I will message you here. Just reply “ok”, “can't” or “done”.`, tl: (n: string) => `Salamat, ${n}! Dito ako magmemensahe. Sagutin lang: “ok”, “hindi ko kaya”, “tapos na”.` },
  adminHint: { ru: 'Вы администратор: просто напишите, что нужно сделать — например «завтра в 17 забрать Машу из сада и купить молоко» — и я распределю.', en: 'You are an admin: just tell me what needs doing — e.g. “pick up Masha at 5pm and buy milk” — and I will dispatch it.', tl: 'Admin ka: sabihin lang kung ano ang kailangang gawin at ipamamahagi ko.' },
  taken: { ru: 'Этот человек уже привязан к другому чату. Выберите другого или напишите /switch там.', en: 'That member is already linked to another chat.', tl: 'Naka-link na ang taong ito sa ibang chat.' },
  noTask: { ru: 'Сейчас у вас нет дел, которые ждут ответа.', en: 'You have no tasks waiting for a reply right now.', tl: 'Wala kang gawain na naghihintay ng sagot ngayon.' },
  accepted: { ru: (t: string) => `Принято: «${t}». Спасибо!`, en: (t: string) => `Got it: “${t}”. Thanks!`, tl: (t: string) => `Salamat! Tanggap: “${t}”.` },
  declined: { ru: (t: string, to?: string) => `Понял. «${t}» ${to ? `передаю: ${to}` : 'пока без исполнителя — сообщу автору'}.`, en: (t: string, to?: string) => `Understood. “${t}” ${to ? `goes to ${to}` : 'has no one yet — I will tell the author'}.`, tl: (t: string, to?: string) => `Sige. “${t}” ${to ? `ibibigay kay ${to}` : 'wala pang gagawa — sasabihin ko sa may-ari'}.` },
  done: { ru: (t: string) => `🎉 «${t}» — сделано, записал!`, en: (t: string) => `🎉 “${t}” — done, noted!`, tl: (t: string) => `🎉 “${t}” — tapos na, naitala!` },
  photoNoTask: { ru: 'Спасибо за фото! Но открытых дел, которые ждут подтверждения, у вас нет.', en: 'Thanks for the photo! But you have no open task waiting for proof.', tl: 'Salamat sa larawan! Pero wala kang bukas na gawain.' },
  forwarded: { ru: (a: string) => `Передал ${a}.`, en: (a: string) => `Passed on to ${a}.`, tl: (a: string) => `Ipinasa kay ${a}.` },
  thinking: { ru: 'Разбираюсь, кому что поручить…', en: 'Working out who does what…', tl: 'Inaayos ko kung sino ang gagawa…' },
  noModel: { ru: 'На сервере не настроен ключ модели — распределять новые дела пока не могу.', en: 'No model key is configured on the server — I cannot dispatch new tasks yet.', tl: 'Walang model key sa server.' },
  myTasks: { ru: 'Ваши дела:', en: 'Your tasks:', tl: 'Mga gawain mo:' },
  help: {
    ru: 'Я понимаю обычные ответы: «ок», «не могу», «могу через 2 часа», «готово», фото как подтверждение.\nКоманды: /tasks — мои дела, /report — итоги недели, /panel — веб-панель, /switch — выбрать другого члена семьи (для теста).',
    en: 'I understand plain replies: “ok”, “can’t”, “can in 2 hours”, “done”, a photo as proof.\nCommands: /tasks — my tasks, /report — weekly summary, /panel — web panel, /switch — pick another member (for testing).',
    tl: 'Naiintindihan ko: “ok”, “hindi ko kaya”, “tapos na”, larawan bilang patunay.\nCommands: /tasks, /report, /panel, /switch.',
  },
  btnOk: { ru: 'ок ✅', en: 'ok ✅', tl: 'ok ✅' }, btnNo: { ru: 'не могу', en: "can't", tl: 'hindi ko kaya' }, btnLater: { ru: 'могу через 2 ч', en: 'can in 2 h', tl: 'mamaya (2 h)' }, btnDone: { ru: 'готово 🎉', en: 'done 🎉', tl: 'tapos na 🎉' },
} as const;
const t = <K extends keyof typeof T>(k: K, l: Lang) => (T[k] as any)[ui(l)] as (typeof T)[K]['en'];

// ---------- reply parsing ----------
export type Parsed = { kind: 'accept' } | { kind: 'decline'; proposeAt?: string } | { kind: 'done' } | { kind: 'none' };

/** Understand short human replies in RU / EN / TL. `nowIso` + `tz` are needed for “at 19:00”. */
export function parseReply(raw: string, nowIso: string, tz = 'Asia/Dubai'): Parsed {
  const s = raw.trim().toLowerCase();
  if (!s) return { kind: 'none' };
  if (/^(готово|сделал[аи]?|сделано|done|finished|tapos( na)?|✅|🎉)(?!\p{L})/u.test(s) || /^(всё|все) (готово|сделал)/u.test(s)) return { kind: 'done' };
  const declineRe = /(не (с)?могу|не получится|не успе|can'?t|cannot|can not|unable|not able|hindi( ko)? kaya|ayaw|busy|занят|^нет(?!\p{L})|^no(?!\p{L}))/u;
  if (declineRe.test(s)) {
    let proposeAt: string | undefined;
    const rel = s.match(/(?:через|in|sa loob ng|pagkatapos ng)\s+(\d+(?:[.,]\d+)?)\s*(мин|min|м\b|m\b|ч|час|h|hour|oras)/u);
    if (rel) {
      const n = parseFloat(rel[1].replace(',', '.'));
      const ms = /^(мин|min|м|m)/.test(rel[2]) ? n * 60_000 : n * 3_600_000;
      proposeAt = new Date(Date.parse(nowIso) + ms).toISOString();
    } else {
      const abs = s.match(/(?:в|at|к|by|sa|ng)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:ч|h)?\b/u);
      if (abs) proposeAt = nextLocalTime(nowIso, tz, +abs[1], +(abs[2] ?? 0));
    }
    return { kind: 'decline', proposeAt };
  }
  if (/^(ок|окей|ok|okay|да|хорошо|ладно|конечно|yes|sure|yep|sige|oo|opo|👍|✔)(?!\p{L})/u.test(s)) return { kind: 'accept' };
  return { kind: 'none' };
}

/** Today at HH:MM in `tz` (tomorrow if already past). Fixed-offset zones only (Dubai has no DST). */
function nextLocalTime(nowIso: string, tz: string, h: number, m: number): string {
  const offsetMin = tzOffsetMinutes(tz, nowIso);
  const now = new Date(nowIso);
  const local = new Date(now.getTime() + offsetMin * 60_000);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - offsetMin * 60_000);
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.toISOString();
}
function tzOffsetMinutes(tz: string, iso: string): number {
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
    const g = (k: string) => +parts.find(p => p.type === k)!.value;
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
    return Math.round((asUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
  } catch { return 240; }
}

// ---------- helpers ----------
const chatOf = (u: TgUpdate) => String(u.message?.chat.id ?? u.callback_query?.message?.chat.id ?? u.callback_query?.from.id ?? '');
const byChat = (members: Member[], chatId: string) => members.find(m => m.telegramId === chatId);
const fmtTime = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return iso.slice(11, 16); } };

function waitingTask(tasks: Task[], memberId: string, statuses: Task['status'][]): Task | undefined {
  return tasks.filter(x => x.assigneeId === memberId && statuses.includes(x.status)).sort((a, b) => (b.assignedAt ?? b.createdAt).localeCompare(a.assignedAt ?? a.createdAt))[0];
}

function keyboardFor(msg: OutgoingMessage, m: Member, task?: Task): Button[][] | undefined {
  if (!msg.taskId) return undefined;
  const l = m.lang;
  if (msg.kind === 'assignment') {
    if (m.role === 'child') return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }]];
    const row: Button[] = [{ text: t('btnOk', l), data: `a:${msg.taskId}` }, { text: t('btnNo', l), data: `d:${msg.taskId}` }];
    if (!task?.urgent) row.push({ text: t('btnLater', l), data: `l:${msg.taskId}` });
    return [row];
  }
  if (msg.kind === 'reminder') return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }]];
  return undefined;
}

/** Deliver all pending (not yet delivered) outbox entries. Unlinked recipients → echo to linked admins. */
export async function flushOutbox(store: DomovoyStore, send: TgSender): Promise<number> {
  const [members, tasks, msgs] = await Promise.all([store.members(), store.tasks(), store.pending()]);
  if (!msgs.length) return 0;
  const admins = members.filter(m => m.isAdmin && m.telegramId);
  const delivered: (string | number)[] = [];
  for (const msg of msgs) {
    const m = members.find(x => x.id === msg.toId);
    if (!m) continue;
    const task = tasks.find(x => x.id === msg.taskId);
    if (m.telegramId) {
      await send.sendMessage(m.telegramId, msg.text, keyboardFor(msg, m, task));
    } else {
      for (const a of admins) await send.sendMessage(a.telegramId!, `📨 → ${m.name}:\n${msg.text}`);
    }
    if (msg.id != null) delivered.push(msg.id);
  }
  if (delivered.length) await store.markDelivered(delivered);
  return msgs.length;
}

// ---------- main entry ----------
export async function handleUpdate(store: DomovoyStore, upd: TgUpdate, deps: TelegramDeps): Promise<void> {
  if (deps.seen) { if (deps.seen.has(upd.update_id)) return; deps.seen.add(upd.update_id); }
  const now = deps.now ?? new Date().toISOString();
  const tz = deps.tz ?? 'Asia/Dubai';
  const { send } = deps;
  const chatId = chatOf(upd);
  if (!chatId) return;
  const members = await store.members();
  const flush = () => flushOutbox(store, send);

  // ---- inline buttons ----
  if (upd.callback_query) {
    const cq = upd.callback_query;
    const [op, arg] = (cq.data ?? '').split(':');
    if (op === 'link') {
      const m = members.find(x => x.id === arg);
      if (!m) { await send.answerCallback(cq.id); return; }
      if (m.telegramId && m.telegramId !== chatId) { await send.answerCallback(cq.id, t('taken', m.lang) as string); return; }
      for (const x of members) if (x.telegramId === chatId) { x.telegramId = undefined; await store.saveMember(x); }
      m.telegramId = chatId;
      await store.saveMember(m);
      await send.answerCallback(cq.id);
      if (cq.message) await send.clearKeyboard(chatId, cq.message.message_id);
      await send.sendMessage(chatId, (t('linked', m.lang) as any)(m.name) + (m.isAdmin ? '\n\n' + t('adminHint', m.lang) : ''));
      return;
    }
    const me = byChat(members, chatId);
    if (!me) { await send.answerCallback(cq.id); await askWho(); return; }
    const tasks = await store.tasks();
    const task = tasks.find(x => x.id === arg);
    try {
      if (op === 'a' && task) { await respond(store, task.id, me.id, 'accept', now); await send.answerCallback(cq.id, '✅'); await send.sendMessage(chatId, (t('accepted', me.lang) as any)(task.text)); }
      else if (op === 'd' && task) { const r = await respond(store, task.id, me.id, 'decline', now); await send.answerCallback(cq.id); await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo))); }
      else if (op === 'l' && task) { const r = await respond(store, task.id, me.id, 'decline', now, { proposeAt: new Date(Date.parse(now) + 2 * 3_600_000).toISOString() }); await send.answerCallback(cq.id); if (!r.rescheduled) await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo))); }
      else if (op === 'f' && task) { const r = await markDone(store, task.id, me.id, now); await send.answerCallback(cq.id); if (!r.needProof) await send.sendMessage(chatId, (t('done', me.lang) as any)(task.text)); }
      else await send.answerCallback(cq.id);
      if (cq.message && task) await send.clearKeyboard(chatId, cq.message.message_id);
    } catch { await send.answerCallback(cq.id, '⌛'); }
    await flush();
    return;
  }

  const msg = upd.message;
  if (!msg) return;
  const text = (msg.text ?? msg.caption ?? '').trim();
  const me = byChat(members, chatId);

  // ---- commands ----
  if (/^\/start/.test(text)) {
    const wanted = text.split(/\s+/)[1];
    const m = wanted ? members.find(x => x.id === wanted) : undefined;
    if (m && (!m.telegramId || m.telegramId === chatId)) {
      for (const x of members) if (x.telegramId === chatId) { x.telegramId = undefined; await store.saveMember(x); }
      m.telegramId = chatId;
      await store.saveMember(m);
      await send.sendMessage(chatId, (t('linked', m.lang) as any)(m.name) + (m.isAdmin ? '\n\n' + t('adminHint', m.lang) : ''));
      return;
    }
    if (me) { await send.sendMessage(chatId, (t('linked', me.lang) as any)(me.name) + '\n\n' + t('help', me.lang)); return; }
    await askWho(); return;
  }
  if (/^\/switch/.test(text)) { await askWho(); return; }
  if (!me) { await askWho(); return; }
  if (/^\/help/.test(text)) { await send.sendMessage(chatId, t('help', me.lang) as string); return; }
  if (/^\/whoami/.test(text)) { await send.sendMessage(chatId, `${me.name} · ${me.role} · ${me.lang}${me.isAdmin ? ' · admin' : ''}`); return; }
  if (/^\/tasks/.test(text)) {
    const mine = (await store.tasks()).filter(x => x.assigneeId === me.id && ['assigned', 'accepted'].includes(x.status));
    await send.sendMessage(chatId, mine.length ? `${t('myTasks', me.lang)}\n` + mine.map(x => `• ${x.text}${x.dueAt ? ' — ' + fmtTime(x.dueAt, tz) : ''} (${x.status === 'assigned' ? '?' : '✓'})`).join('\n') : (t('noTask', me.lang) as string));
    return;
  }
  if (/^\/report/.test(text)) {
    const { rows, suggestion } = await weeklyReport(store, now, me.lang === 'ru' ? 'ru' : 'en');
    await send.sendMessage(chatId, rows.map(r => `${r.name}: ${r.minutes} ${me.lang === 'ru' ? 'мин' : 'min'}, ${r.tasks} ${me.lang === 'ru' ? 'дел' : 'tasks'}`).join('\n') + '\n\n' + suggestion);
    return;
  }

  const tasks = await store.tasks();

  // ---- photo = proof ----
  if (msg.photo?.length) {
    const task = waitingTask(tasks, me.id, ['accepted', 'assigned']);
    if (!task) { await send.sendMessage(chatId, t('photoNoTask', me.lang) as string); return; }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await markDone(store, task.id, me.id, now, { proofUrl: `tg:${fileId}` });
    await send.sendMessage(chatId, (t('done', me.lang) as any)(task.text));
    await flush();
    return;
  }

  // ---- short replies ----
  const parsed = parseReply(text, now, tz);
  if (parsed.kind !== 'none') {
    const statuses: Task['status'][] = parsed.kind === 'done' ? ['accepted', 'assigned'] : ['assigned'];
    const task = waitingTask(tasks, me.id, statuses);
    if (!task) {
      // a bare "ok" with nothing pending is just chatter; a longer message from an admin may be a task
      if (parsed.kind === 'accept' && text.length <= 12) { await send.sendMessage(chatId, t('noTask', me.lang) as string); return; }
      if (parsed.kind !== 'accept') { await send.sendMessage(chatId, t('noTask', me.lang) as string); return; }
    } else {
      if (parsed.kind === 'accept') { await respond(store, task.id, me.id, 'accept', now); await send.sendMessage(chatId, (t('accepted', me.lang) as any)(task.text)); }
      else if (parsed.kind === 'decline') { const r = await respond(store, task.id, me.id, 'decline', now, { proposeAt: parsed.proposeAt }); if (!r.rescheduled) await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo))); }
      else { const r = await markDone(store, task.id, me.id, now); if (!r.needProof) await send.sendMessage(chatId, (t('done', me.lang) as any)(task.text)); }
      await flush();
      return;
    }
  }

  // ---- free text ----
  if (me.isAdmin || me.role === 'adult') {
    if (!deps.model) { await send.sendMessage(chatId, t('noModel', me.lang) as string); return; }
    try {
      const client = await deps.model();
      const result = await runDispatch(client, store, me.id, text, { now, tz });
      await flush();
      // Summary only when something non-obvious happened (unassigned tasks, blocked members)
      // Skip bare "✓" — the assignment messages already tell the author what happened
      const s = result.summary?.trim();
      if (s && s !== '✓' && s !== '✔') await send.sendMessage(chatId, s);
    } catch (e: any) {
      await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`);
    }
    return;
  }
  // children / helpers: pass the message to the admins
  const admins = members.filter(x => x.isAdmin && x.telegramId && x.id !== me.id);
  for (const a of admins) await send.sendMessage(a.telegramId!, `💬 ${me.name}: ${text}`);
  const adminNames = members.filter(x => x.isAdmin).map(x => x.name).join(', ');
  await send.sendMessage(chatId, (t('forwarded', me.lang) as any)(adminNames));

  async function askWho() {
    const l: Lang = (msg?.from?.language_code?.startsWith('ru') ? 'ru' : 'en');
    const rows: Button[][] = [];
    const free = members.filter(x => !x.telegramId || x.telegramId === chatId);
    for (let i = 0; i < free.length; i += 2) rows.push(free.slice(i, i + 2).map(x => ({ text: `${x.name}${x.role === 'child' ? ' 🧒' : x.role === 'helper' ? ' 🧹' : x.role === 'elder' ? ' 👵' : ''}`, data: `link:${x.id}` })));
    await send.sendMessage(chatId, t('whoAreYou', l) as string, rows);
  }
}

const nameOf = (members: Member[], id?: string) => (id ? members.find(m => m.id === id)?.name : undefined);

/** Run the scheduler and deliver whatever it produced. */
export async function tickAndFlush(store: DomovoyStore, send: TgSender, nowIso = new Date().toISOString()) {
  await tick(store, nowIso);
  return flushOutbox(store, send);
}

/** Thin fetch-based Telegram Bot API client. */
export function telegramSender(token: string): TgSender {
  const api = (method: string, body: unknown) => fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => undefined);
  return {
    async sendMessage(chatId, text, keyboard) {
      await api('sendMessage', { chat_id: chatId, text, reply_markup: keyboard ? { inline_keyboard: keyboard.map(r => r.map(b => ({ text: b.text, callback_data: b.data }))) } : undefined });
    },
    async answerCallback(id, text) { await api('answerCallbackQuery', { callback_query_id: id, text }); },
    async clearKeyboard(chatId, messageId) { await api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }); },
  };
}
