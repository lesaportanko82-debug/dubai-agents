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
import { transcribeVoice } from './integrations';
import { analyzePhoto } from './integrations';
import { runDemo, type DemoKind } from './demo';
import { decideApproval } from './approvals';
import { impactMetrics, formatImpact } from './metrics';
import { learningReport, formatLearning } from './learning';
import { CURRENCIES, DEFAULT_THRESHOLD, formatMoney, parseCurrency } from './policy';
import { editWallet, formatWallet, refundPayment } from './payments';
import { formatProfile, rememberFact, visibleFacts } from './profile';
import { cartCancel, cartPaid, cartPayFromWallet } from './shopping';

// ---------- Telegram shapes (only what we use) ----------
export interface TgUser { id: number; first_name?: string; language_code?: string }
export interface TgChat { id: number; type: string }
export interface TgMessage {
  message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string; caption?: string;
  photo?: { file_id: string; width: number; height: number }[];
  voice?: { file_id: string; duration: number; mime_type?: string };
}
export interface TgCallback { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

export type Button = { text: string; data: string; url?: string };
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
  /** persist the family's currency / money threshold (admin command /currency) */
  setMoneyPolicy?: (currency: import('./policy').Currency, threshold: number) => Promise<void>;
}

// ---------- UI strings ----------
type UiLang = 'ru' | 'en' | 'tl';
const ui = (l: Lang): UiLang => (l === 'ru' || l === 'tl' ? l : 'en');
const T = {
  whoAreYou: { ru: 'Привет! Я Домовёнок — помогаю семье делить домашние дела. Кто вы в семье?', en: 'Hi! I am Domovoy, the family dispatcher. Who are you in the family?', tl: 'Hi! Ako si Domovoy, katulong ng pamilya. Sino ka sa pamilya?' },
  linked: { ru: (n: string) => `Отлично, ${n}! Теперь я буду писать вам сюда. Отвечайте просто: «ок», «не могу», «готово».`, en: (n: string) => `Great, ${n}! I will message you here. Just reply “ok”, “can't” or “done”.`, tl: (n: string) => `Salamat, ${n}! Dito ako magmemensahe. Sagutin lang: “ok”, “hindi ko kaya”, “tapos na”.` },
  adminHint: { ru: 'Вы администратор: просто напишите, что нужно сделать — например «завтра в 17 забрать Машу из сада и купить молоко» — и я распределю.', en: 'You are an admin: just tell me what needs doing — e.g. “pick up Masha at 5pm and buy milk” — and I will dispatch it.', tl: 'Admin ka: sabihin lang kung ano ang kailangang gawin at ipamamahagi ko.' },
  memberHint: { ru: 'Напишите, что нужно сделать или попросите кого-то о помощи — я передам как просьбу.', en: 'Tell me what you need or ask someone for help — I will pass it as a request.', tl: 'Sabihin kung ano ang kailangan mo — ipapasa ko bilang kahilingan.' },
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
    ru: 'Я понимаю обычные ответы: «ок», «не могу», «могу через 2 часа», «готово», фото как подтверждение.\nКоманды: /tasks — мои дела, /report — итоги недели, /impact — что я сделал и сколько времени сэкономил, /learned — чему научился, /currency — валюта и порог трат, /wallet — правила оплаты, /orders — заказы, /profile — профиль семьи, /approvals — что ждёт вашего решения, /connect — подключить Google Calendar, /panel — веб-панель, /switch — выбрать другого члена семьи (для теста).',
    en: 'I understand plain replies: “ok”, “can’t”, “can in 2 hours”, “done”, a photo as proof.\nCommands: /tasks — my tasks, /report — weekly summary, /impact — what I did and the time saved, /learned — what I have learned, /currency — currency and spending threshold, /wallet — payment rules, /orders — orders, /profile — family profile, /approvals — decisions waiting for you, /connect — Google Calendar, /panel — web panel, /switch — pick another member (for testing).',
    tl: 'Naiintindihan ko: “ok”, “hindi ko kaya”, “tapos na”, larawan bilang patunay.\nCommands: /tasks, /report, /panel, /switch.',
  },
  btnApprove: { ru: 'да, делай ✅', en: 'yes, do it ✅', tl: 'oo, gawin ✅' }, btnReject: { ru: 'нет, оставь', en: 'no, leave it', tl: 'hindi, hayaan' },
  btnUndo: { ru: '↩️ отменить', en: '↩️ undo', tl: '↩️ bawiin' }, btnRefund: { ru: '↩️ вернуть деньги', en: '↩️ refund', tl: '↩️ ibalik ang pera' },
  btnOpenShop: { ru: '🔗 открыть магазин', en: '🔗 open the shop', tl: '🔗 buksan ang tindahan' }, btnPaid: { ru: '✅ оплатил(а)', en: '✅ paid', tl: '✅ nabayaran' }, btnWallet: { ru: '💳 из кошелька семьи', en: '💳 from the family wallet', tl: '💳 mula sa wallet' }, btnNoNeed: { ru: '❌ не нужно', en: '❌ not needed', tl: '❌ hindi na' }, btnNotDone: { ru: 'не сделано', en: 'not done', tl: 'hindi pa' },
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

function keyboardFor(msg: OutgoingMessage, m: Member, task?: Task, extra?: { cartUrl?: string; walletEligible?: boolean; lineLinks?: { text: string; url: string }[] }): Button[][] | undefined {
  const l = m.lang;
  // a shopping cart: open the shop (+ per-item search links), paid, wallet, not needed
  if (msg.kind === 'cart' && msg.cartId) {
    const rows: Button[][] = [];
    if (extra?.cartUrl) rows.push([{ text: t('btnOpenShop', l), data: '', url: extra.cartUrl }]);
    for (const ln of (extra?.lineLinks ?? []).slice(0, 6)) rows.push([{ text: `🔍 ${ln.text.slice(0, 30)}`, data: '', url: ln.url }]);
    const act: Button[] = [{ text: t('btnPaid', l), data: `cp:${msg.cartId}` }];
    if (extra?.walletEligible) act.push({ text: t('btnWallet', l), data: `cw:${msg.cartId}` });
    act.push({ text: t('btnNoNeed', l), data: `cc:${msg.cartId}` });
    rows.push(act);
    return rows;
  }
  // human checkpoint: approve / reject
  if (msg.kind === 'approval' && msg.approvalId) return [[{ text: t('btnApprove', l), data: `ap:${msg.approvalId}` }, { text: t('btnReject', l), data: `rj:${msg.approvalId}` }]];
  // a paid order → one-tap refund
  if (msg.kind === 'receipt' && msg.paymentId) return [[{ text: t('btnRefund', l), data: `rf:${msg.paymentId}` }]];
  if (!msg.taskId) return undefined;
  // the agent acted on its own → one-tap undo
  if (msg.kind === 'autonomous') return [[{ text: t('btnUndo', l), data: `ux:${msg.taskId}` }]];
  // closing the loop: did it happen?
  if (msg.kind === 'verification') return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }, { text: t('btnNotDone', l), data: `nd:${msg.taskId}` }]];
  if (msg.kind === 'assignment' || msg.kind === 'request') {
    // Self-task: author assigned to themselves → no confirmation needed, only "done" button
    if (task && task.authorId === task.assigneeId) {
      return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }]];
    }
    if (m.role === 'child') return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }]];
    const row: Button[] = [{ text: t('btnOk', l), data: `a:${msg.taskId}` }, { text: t('btnNo', l), data: `d:${msg.taskId}` }];
    if (!task?.urgent) row.push({ text: t('btnLater', l), data: `l:${msg.taskId}` });
    return [row];
  }
  if (msg.kind === 'reminder') return [[{ text: t('btnDone', l), data: `f:${msg.taskId}` }]];
  // Unassigned task: show action buttons to author
  if (msg.kind === 'info' && task?.status === 'unassigned') {
    return [[
      { text: l === 'ru' ? '📅 На завтра' : '📅 Tomorrow', data: `mv:${msg.taskId}` },
      { text: l === 'ru' ? '❌ Отменить' : '❌ Cancel', data: `cx:${msg.taskId}` },
    ]];
  }
  return undefined;
}

/** Deliver all pending (not yet delivered) outbox entries. Unlinked recipients → echo to linked admins. */
export async function flushOutbox(store: DomovoyStore, send: TgSender): Promise<number> {
  const [members, tasks, msgs] = await Promise.all([store.members(), store.tasks(), store.pending()]);
  if (!msgs.length) return 0;
  const carts = msgs.some(m => m.kind === 'cart') ? await store.carts() : [];
  const wallet = carts.length ? await store.wallet() : undefined;
  const admins = members.filter(m => m.isAdmin && m.telegramId);
  const delivered: (string | number)[] = [];
  for (const msg of msgs) {
    const m = members.find(x => x.id === msg.toId);
    if (!m) continue;
    const task = tasks.find(x => x.id === msg.taskId);
    if (m.telegramId) {
      const cart = msg.cartId ? carts.find(c => c.id === msg.cartId) : undefined;
      const extra = cart ? { cartUrl: cart.homeUrl, walletEligible: !!wallet?.knownMerchants.find(k => k.name.toLowerCase() === cart.merchant.toLowerCase() && k.agentCheckout), lineLinks: cart.lines.filter(l => l.link).map(l => ({ text: l.text, url: l.link! })) } : undefined;
      await send.sendMessage(m.telegramId, msg.text, keyboardFor(msg, m, task, extra));
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
      await send.sendMessage(chatId, (t('linked', m.lang) as any)(m.name) + '\n\n' + (m.isAdmin ? t('adminHint', m.lang) : t('memberHint', m.lang)));
      return;
    }
    const me = byChat(members, chatId);
    if (!me) { await send.answerCallback(cq.id); await askWho(); return; }
    if (op === 'cp' || op === 'cw' || op === 'cc') {
      try {
        const r = op === 'cp' ? await cartPaid(store, arg, me.id, now) : op === 'cw' ? await cartPayFromWallet(store, arg, me.id, now) : await cartCancel(store, arg, me.id, now);
        await send.answerCallback(cq.id, r.ok ? '✅' : '🔒');
        if (r.ok && cq.message) await send.clearKeyboard(chatId, cq.message.message_id);
        await send.sendMessage(chatId, me.lang === 'ru' ? r.note.ru : r.note.en);
      } catch (e: any) { await send.answerCallback(cq.id, '⌛'); await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`); }
      await flush();
      return;
    }
    if (op === 'rf') {
      try {
        const r = await refundPayment(store, arg, me.id, now);
        await send.answerCallback(cq.id, r.ok ? '↩️' : '🔒');
        if (r.ok && cq.message) await send.clearKeyboard(chatId, cq.message.message_id);
        await send.sendMessage(chatId, me.lang === 'ru' ? r.note.ru : r.note.en);
      } catch (e: any) { await send.answerCallback(cq.id, '⌛'); await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`); }
      await flush();
      return;
    }
    if (op === 'ap' || op === 'rj') {
      try {
        const r = await decideApproval(store, arg, me.id, op === 'ap' ? 'approve' : 'reject', now);
        await send.answerCallback(cq.id, op === 'ap' ? '✅' : '↩️');
        if (cq.message && r.outcome !== 'not_allowed') await send.clearKeyboard(chatId, cq.message.message_id);
        await send.sendMessage(chatId, me.lang === 'ru' ? r.note.ru : r.note.en);
      } catch (e: any) { await send.answerCallback(cq.id, '⌛'); await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`); }
      await flush();
      return;
    }
    const tasks = await store.tasks();
    const task = tasks.find(x => x.id === arg);
    try {
      if (op === 'ux' && task) {
        // undo an autonomous action: only the author or an admin, only while nothing has been done
        if (!(me.isAdmin || me.id === task.authorId)) { await send.answerCallback(cq.id, '🔒'); }
        else if (task.status === 'done') { await send.answerCallback(cq.id, me.lang === 'ru' ? 'Уже сделано' : 'Already done'); }
        else {
          task.status = 'cancelled'; await store.saveTask(task);
          await store.event({ at: now, taskId: task.id, actor: me.id, type: 'blocked', details: { reason: 'undo autonomous action' } });
          const assignee = members.find(x => x.id === task.assigneeId);
          if (assignee && assignee.id !== me.id) await store.send({ at: now, toId: assignee.id, lang: assignee.lang, kind: 'info', taskId: task.id, text: assignee.lang === 'ru' ? `❌ Отбой: «${task.text}» не нужно.` : `❌ Never mind: "${task.text}" is not needed.` });
          await send.answerCallback(cq.id, '↩️');
          await send.sendMessage(chatId, me.lang === 'ru' ? `Отменил: «${task.text}». Запомню, что это было лишним.` : `Undone: "${task.text}". I will remember this was unnecessary.`);
        }
      }
      else if (op === 'nd' && task) {
        const r = await respond(store, task.id, me.id, 'decline', now);
        await send.answerCallback(cq.id);
        await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo)));
      }
      else if (op === 'a' && task) { await respond(store, task.id, me.id, 'accept', now); await send.answerCallback(cq.id, '✅'); await send.sendMessage(chatId, (t('accepted', me.lang) as any)(task.text)); }
      else if (op === 'd' && task) { const r = await respond(store, task.id, me.id, 'decline', now); await send.answerCallback(cq.id); await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo))); }
      else if (op === 'l' && task) { const r = await respond(store, task.id, me.id, 'decline', now, { proposeAt: new Date(Date.parse(now) + 2 * 3_600_000).toISOString() }); await send.answerCallback(cq.id); if (!r.rescheduled) await send.sendMessage(chatId, (t('declined', me.lang) as any)(task.text, nameOf(members, r.swappedTo))); }
      else if (op === 'f' && task) { const r = await markDone(store, task.id, me.id, now); await send.answerCallback(cq.id); if (!r.needProof) await send.sendMessage(chatId, (t('done', me.lang) as any)(task.text)); }
      else if (op === 'mv' && task && task.status === 'unassigned') {
        // Move to tomorrow: reschedule dueAt to same time next day, reset state to 'new'
        const tmrw = new Date(Date.parse(now) + 86_400_000);
        if (task.dueAt) { const d = new Date(task.dueAt); d.setDate(d.getDate() + 1); task.dueAt = d.toISOString(); }
        else task.dueAt = tmrw.toISOString();
        task.rescheduledFrom = now; task.status = 'new'; task.declinedBy = []; task.candidateIds = [];
        await store.saveTask(task); await store.event({ at: now, taskId: task.id, actor: me.id, type: 'rescheduled', details: { to: task.dueAt } });
        await send.answerCallback(cq.id, '📅');
        await send.sendMessage(chatId, me.lang === 'ru' ? `Перенесено на завтра: «${task.text}»` : `Moved to tomorrow: "${task.text}"`);
      }
      else if (op === 'cx' && task && task.status === 'unassigned') {
        task.status = 'cancelled';
        await store.saveTask(task); await store.event({ at: now, taskId: task.id, actor: me.id, type: 'blocked', details: { reason: 'cancelled by author' } });
        await send.answerCallback(cq.id, '❌');
        await send.sendMessage(chatId, me.lang === 'ru' ? `Отменено: «${task.text}»` : `Cancelled: "${task.text}"`);
      }
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
      await send.sendMessage(chatId, (t('linked', m.lang) as any)(m.name) + '\n\n' + (m.isAdmin ? t('adminHint', m.lang) : t('memberHint', m.lang)));
      return;
    }
    if (me) { await send.sendMessage(chatId, (t('linked', me.lang) as any)(me.name) + '\n\n' + t('help', me.lang)); return; }
    await askWho(); return;
  }
  if (/^\/switch/.test(text)) { await askWho(); return; }
  if (!me) { await askWho(); return; }
  if (/^\/help/.test(text)) { await send.sendMessage(chatId, t('help', me.lang) as string); return; }
  if (/^\/(connect|calendar_connect|подключить)/.test(text)) {
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_URL ?? 'https://dubai-agents.vercel.app';
    const host = baseUrl.replace(/^https?:\/\//, '');
    const calendarUrl = `https://${host}/api/domovoy/calendar/connect?member=${me.id}&household=${store.householdId}`;
    const msg = me.lang === 'ru'
      ? '📅 Подключите Google Calendar, чтобы агент учитывал вашу занятость при назначении задач:'
      : '📅 Connect Google Calendar so the agent checks your availability before assigning tasks:';
    await send.sendMessage(chatId, msg, [[{ text: me.lang === 'ru' ? '🔗 Подключить Google Calendar' : '🔗 Connect Google Calendar', data: '', url: calendarUrl }]]);
    return;
  }
  if (/^\/whoami/.test(text)) { await send.sendMessage(chatId, `${me.name} · ${me.role} · ${me.lang}${me.isAdmin ? ' · admin' : ''}`); return; }
  if (/^\/tasks/.test(text)) {
    const mine = (await store.tasks()).filter(x => x.assigneeId === me.id && ['assigned', 'accepted'].includes(x.status));
    await send.sendMessage(chatId, mine.length ? `${t('myTasks', me.lang)}\n` + mine.map(x => `• ${x.text}${x.dueAt ? ' — ' + fmtTime(x.dueAt, tz) : ''} (${x.status === 'assigned' ? '?' : '✓'})`).join('\n') : (t('noTask', me.lang) as string));
    return;
  }
  if (/^\/impact/.test(text)) {
    const m = await impactMetrics(store, now, 7);
    await send.sendMessage(chatId, formatImpact(m, me.lang));
    return;
  }
  if (/^\/learned/.test(text)) {
    const rep = await learningReport(store, me.lang);
    await send.sendMessage(chatId, formatLearning(rep, me.lang));
    return;
  }
  if (/^\/approvals/.test(text)) {
    const pending = (await store.approvals({ status: 'pending' })).filter(a => a.approverIds.includes(me.id));
    if (!pending.length) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Решений, которые ждут вас, нет.' : 'No decisions are waiting for you.'); return; }
    for (const a of pending) {
      await send.sendMessage(chatId, (me.lang === 'ru' ? `🛡️ ${a.reason.ru}` : `🛡️ ${a.reason.en}`) + `\n⌛ ${fmtTime(a.expiresAt, tz)}`,
        [[{ text: t('btnApprove', me.lang), data: `ap:${a.id}` }, { text: t('btnReject', me.lang), data: `rj:${a.id}` }]]);
    }
    return;
  }
  // /wallet [limit|monthly|allow|block|child|address <value>] — the family's payment rules
  const walletMatch = text.match(/^\/wallet(?:\s+(limit|monthly|allow|block|child|address)\s+(.+))?/i);
  if (walletMatch) {
    if (walletMatch[1]) {
      if (!me.isAdmin) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Правила кошелька меняют только администраторы.' : 'Only admins change the wallet rules.'); return; }
      const note = await editWallet(store, walletMatch[1].toLowerCase(), walletMatch[2], me.lang);
      if (walletMatch[1].toLowerCase() === 'address') await rememberFact(store, me, { key: 'home', value: walletMatch[2], kind: 'place', access: 'family' }, now);
      await send.sendMessage(chatId, note);
      return;
    }
    await send.sendMessage(chatId, formatWallet(await store.wallet(), await store.payments(), now, me.lang));
    return;
  }
  if (/^\/orders/.test(text)) {
    const list = (await store.payments()).filter(p => me.isAdmin || p.requestedBy === me.id).slice(0, 10);
    if (!list.length) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Заказов пока не было.' : 'No orders yet.'); return; }
    const icon: Record<string, string> = { paid: '✅', refunded: '↩️', declined: '🚫', failed: '❌', pending_approval: '⏳' };
    await send.sendMessage(chatId, list.map(p => `${icon[p.status] ?? '•'} ${p.items} · ${p.merchant} · ${formatMoney(p.amount, p.currency)} · ${me.lang === 'ru' ? p.reason.ru : p.reason.en}`).join('\n'));
    return;
  }
  // /profile [set <key> <value> | forget <key>]
  const profMatch = text.match(/^\/profile(?:\s+(set|forget)\s+(\S+)(?:\s+([\s\S]+))?)?/i);
  if (profMatch) {
    try {
      if (profMatch[1]?.toLowerCase() === 'set' && profMatch[3]) {
        const key = profMatch[2];
        const about = key.includes(':') ? members.find(m => m.id === key.split(':')[1])?.id : undefined;
        const f = await rememberFact(store, me, { key, value: profMatch[3], aboutMemberId: about }, now);
        await send.sendMessage(chatId, me.lang === 'ru' ? `✅ Запомнил ${f.key} (доступ: ${f.access}).` : `✅ Remembered ${f.key} (access: ${f.access}).`);
      } else if (profMatch[1]?.toLowerCase() === 'forget') {
        if (!me.isAdmin) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Удалять факты могут администраторы.' : 'Admins delete facts.'); return; }
        await store.deleteFact(profMatch[2].toLowerCase());
        await send.sendMessage(chatId, me.lang === 'ru' ? `🗑 Забыл ${profMatch[2]}.` : `🗑 Forgot ${profMatch[2]}.`);
      } else {
        await send.sendMessage(chatId, formatProfile(await visibleFacts(store, me), members, me.lang));
      }
    } catch (e: any) { await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`); }
    return;
  }
  // /currency [CODE [threshold]] — admin-only: the family's currency and the sum above which parents must approve
  const curMatch = text.match(/^\/currency(?:\s+(\S+))?(?:\s+(\d+))?/i);
  if (curMatch) {
    const current = store.lang === 'ru' || me.lang === 'ru'
      ? `💱 Валюта семьи: ${store.currency}. Траты выше ${formatMoney(store.moneyThreshold, store.currency)} требуют одобрения родителей.\nСменить: /currency KZT 30000 (валюта и порог). Доступно: ${CURRENCIES.join(', ')}.`
      : `💱 Family currency: ${store.currency}. Spending above ${formatMoney(store.moneyThreshold, store.currency)} needs a parent's approval.\nChange: /currency KZT 30000 (currency and threshold). Available: ${CURRENCIES.join(', ')}.`;
    if (!curMatch[1]) { await send.sendMessage(chatId, current); return; }
    if (!me.isAdmin) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Только для администраторов.' : 'Admins only.'); return; }
    const cur = parseCurrency(curMatch[1]);
    if (!cur) { await send.sendMessage(chatId, (me.lang === 'ru' ? 'Не знаю такой валюты. Доступно: ' : 'Unknown currency. Available: ') + CURRENCIES.join(', ')); return; }
    const threshold = curMatch[2] ? parseInt(curMatch[2]) : DEFAULT_THRESHOLD[cur];
    if (deps.setMoneyPolicy) await deps.setMoneyPolicy(cur, threshold);
    else { (store as any).currency = cur; (store as any).moneyThreshold = threshold; }
    await send.sendMessage(chatId, me.lang === 'ru'
      ? `✅ Валюта семьи: ${cur}. Порог одобрения: ${formatMoney(threshold, cur)}. Суммы в других валютах пересчитываю по курсу.`
      : `✅ Family currency: ${cur}. Approval threshold: ${formatMoney(threshold, cur)}. Sums in other currencies are converted.`);
    return;
  }
  // /demo rain|heat|storm — admin-only: run the autonomous scenarios against synthetic weather (for the showcase)
  const demoMatch = text.match(/^\/demo(?:\s+(rain|heat|storm|dry|pay|cart))?/i);
  if (demoMatch) {
    if (!me.isAdmin) { await send.sendMessage(chatId, me.lang === 'ru' ? 'Только для администраторов.' : 'Admins only.'); return; }
    const kind = (demoMatch[1]?.toLowerCase() ?? 'rain') as DemoKind;
    const note = await runDemo(store, me, kind, now);
    await flush();
    await send.sendMessage(chatId, me.lang === 'ru' ? note.ru : note.en);
    return;
  }
  if (/^\/report/.test(text)) {
    const { rows, suggestion } = await weeklyReport(store, now, me.lang === 'ru' ? 'ru' : 'en');
    await send.sendMessage(chatId, rows.map(r => `${r.name}: ${r.minutes} ${me.lang === 'ru' ? 'мин' : 'min'}, ${r.tasks} ${me.lang === 'ru' ? 'дел' : 'tasks'}`).join('\n') + '\n\n' + suggestion);
    return;
  }

  // ---- /busy HH:MM-HH:MM — add a one-time busy slot ----
  const busyMatch = text.match(/^\/busy\s+(\d{1,2}[:.:]\d{2})\s*[-–]\s*(\d{1,2}[:.:]\d{2})(?:\s+(.+))?/i);
  if (busyMatch) {
    const [, from, to, what] = busyMatch;
    const fromNorm = from.replace('.', ':');
    const toNorm = to.replace('.', ':');
    const today = now.slice(0, 10);
    const fromIso = today + 'T' + fromNorm.padStart(5, '0') + ':00';
    const toIso = today + 'T' + toNorm.padStart(5, '0') + ':00';
    me.busy.push({ from: fromIso, to: toIso, what: what?.trim() });
    await store.saveMember(me);
    await send.sendMessage(chatId, me.lang === 'ru' ? `Записал: занят ${fromNorm}–${toNorm}${what ? ' (' + what.trim() + ')' : ''}.` : `Noted: busy ${fromNorm}–${toNorm}${what ? ' (' + what.trim() + ')' : ''}.`);
    return;
  }

  // ---- /free — clear today's busy slots ----
  if (/^\/free/.test(text)) {
    const today = now.slice(0, 10);
    me.busy = me.busy.filter(b => !b.from.startsWith(today));
    await store.saveMember(me);
    await send.sendMessage(chatId, me.lang === 'ru' ? 'Все занятости на сегодня сброшены.' : 'All busy slots for today cleared.');
    return;
  }

  // ---- /calendar — show current availability and busy slots ----
  if (/^\/calendar/.test(text)) {
    const slots = me.availability?.length
      ? me.availability.map(a => { const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']; return `${me.lang === 'ru' ? days[a.day] : ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][a.day]} ${a.from}–${a.to}`; }).join('\n')
      : (me.lang === 'ru' ? 'По умолчанию: 08:00–22:00 каждый день' : 'Default: 08:00–22:00 every day');
    const busyList = me.busy.length
      ? '\n' + (me.lang === 'ru' ? 'Занятости:' : 'Busy:') + '\n' + me.busy.map(b => `${b.from.slice(11,16)}–${b.to.slice(11,16)} ${b.what ?? ''}`).join('\n')
      : '';
    await send.sendMessage(chatId, (me.lang === 'ru' ? '📅 Расписание:\n' : '📅 Schedule:\n') + slots + busyList);
    return;
  }

  const tasks = await store.tasks();

  // ---- voice message → transcribe → dispatch ----
  if (msg.voice) {
    if (!deps.model) { await send.sendMessage(chatId, t('noModel', me.lang) as string); return; }
    try {
      const transcription = await transcribeVoice(msg.voice.file_id);
      if (!transcription.text) { await send.sendMessage(chatId, me.lang === 'ru' ? '🎤 Не удалось распознать голос.' : '🎤 Could not transcribe voice.'); return; }
      // Feed transcribed text through dispatch
      const client = await deps.model();
      const result = await runDispatch(client, store, me.id, transcription.text, { now, tz, mode: store.mode });
      await flush();
      const s = result.summary?.trim();
      const prefix = me.lang === 'ru' ? `🎤 «${transcription.text}»\n\n` : `🎤 "${transcription.text}"\n\n`;
      if (s && s !== '✓' && s !== '✔') await send.sendMessage(chatId, prefix + s);
      else await send.sendMessage(chatId, prefix + (me.lang === 'ru' ? 'Принято — дела распределены, исполнители получили сообщения.' : 'Got it — tasks dispatched, the people involved have been messaged.'));
    } catch (e: any) {
      await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`);
    }
    return;
  }

  // ---- photo = proof OR vision analysis → new tasks ----
  if (msg.photo?.length) {
    const task = waitingTask(tasks, me.id, ['accepted', 'assigned']);
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    if (task) {
      // Photo as proof for existing task
      await markDone(store, task.id, me.id, now, { proofUrl: `tg:${fileId}` });
      await send.sendMessage(chatId, (t('done', me.lang) as any)(task.text));
      await flush();
      return;
    }
    // No waiting task → try vision analysis to create new tasks
    if (deps.model) {
      try {
        const analysis = await analyzePhoto(`tg:${fileId}`);
        if (analysis.confidence > 0.5 && analysis.suggestedTasks.length > 0) {
          const taskDescriptions = analysis.suggestedTasks.map((t: { text: { ru: string; en: string } }) => t.text.en).join(', ');
          const client = await deps.model();
          const result = await runDispatch(client, store, me.id, taskDescriptions, { now, tz, mode: store.mode });
          await flush();
          const prefix = me.lang === 'ru'
            ? `📷 Вижу: ${analysis.description}\n\n`
            : `📷 I see: ${analysis.description}\n\n`;
          const s = result.summary?.trim();
          if (s && s !== '✓' && s !== '✔') await send.sendMessage(chatId, prefix + s);
          else await send.sendMessage(chatId, prefix + '✓');
        } else {
          await send.sendMessage(chatId, me.lang === 'ru' ? '📷 Не могу определить задачу по фото.' : '📷 Cannot determine a task from this photo.');
        }
      } catch (e: any) {
        await send.sendMessage(chatId, t('photoNoTask', me.lang) as string);
      }
      return;
    }
    await send.sendMessage(chatId, t('photoNoTask', me.lang) as string);
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

  // ---- free text → dispatch (any member can create tasks) ----
  if (!deps.model) { await send.sendMessage(chatId, t('noModel', me.lang) as string); return; }
  try {
    const client = await deps.model();
    const result = await runDispatch(client, store, me.id, text, { now, tz, mode: store.mode });
    await flush();
    // Summary only when something non-obvious happened (unassigned tasks, blocked members)
    // Skip bare "✓" — the assignment messages already tell the author what happened
    const s = result.summary?.trim();
    if (s && s !== '✓' && s !== '✔') await send.sendMessage(chatId, s);
  } catch (e: any) {
    await send.sendMessage(chatId, `⚠️ ${e?.message ?? String(e)}`);
  }

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
  const api = async (method: string, body: unknown) => {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const opts: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url, opts);
        if (r.ok || (r.status < 500 && r.status !== 429)) return r.json();
        // 429 — respect Retry-After; 5xx — exponential backoff
        const ra = r.headers.get('retry-after');
        const delay = ra ? Math.min(Number(ra) * 1000, 10_000) : Math.min(1000 * 2 ** attempt, 8000);
        if (attempt < 3) await new Promise(ok => setTimeout(ok, delay));
        continue;
      } catch { /* network error — retry with backoff */ }
      if (attempt < 3) await new Promise(ok => setTimeout(ok, Math.min(1000 * 2 ** attempt, 8000)));
    }
    return undefined;
  };
  return {
    async sendMessage(chatId, text, keyboard) {
      await api('sendMessage', { chat_id: chatId, text, reply_markup: keyboard ? { inline_keyboard: keyboard.map(r => r.map(b => b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })) } : undefined });
    },
    async answerCallback(id, text) { await api('answerCallbackQuery', { callback_query_id: id, text }); },
    async clearKeyboard(chatId, messageId) { await api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }); },
  };
}
