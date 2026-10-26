/**
 * Closing the loop.
 *
 * Everything here runs from the scheduler tick without anyone asking. Each scenario is one
 * full chain: observe (weather, calendar, history) → detect (a conflict, a predictable need) →
 * decide how autonomously to act (learning.ts) → act through a human checkpoint or directly
 * (approvals.ts) → verify it really happened → report back to the person who would otherwise
 * have had to chase it.
 *
 *  1. weatherConflicts   rain window ∩ outdoor task/activity → propose a free slot (calendar) → approval →
 *                        reschedule → verify → report. On "no": a small "take a raincoat" task instead.
 *  2. weatherChores      low-risk chores (laundry in before rain) → act directly, report with undo.
 *  3. predictions        recurring chores that are due again → remind / ask / act by autonomy level.
 *  4. verification       agent-managed tasks past verifyAt → "did it happen?" → escalate or close the loop.
 */
import { randomUUID } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { Lang, Member, Task } from './types';
import { analyzeWeatherAlerts, checkCalendar, type WeatherAlert, type WeatherData } from './integrations';
import { executeAction, requestApproval, touchesChild } from './approvals';
import { choreHistory, decideAutonomy } from './learning';
import { hhmm, respond } from './household';

const say = (lang: Lang, ru: string, en: string) => (lang === 'ru' ? ru : en);
const t2 = (x: string) => new Date(x).getTime();
const plus = (iso: string, min: number) => new Date(t2(iso) + min * 60_000).toISOString();
const DAY = 86_400_000;

/** "20:02" today, "завтра 20:02" / "tomorrow 20:02", or "28.10 20:02" further out. */
export function fmtWhen(iso: string, tz: string, nowIso: string, lang: 'ru' | 'en'): string {
  const day = (x: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
  const d = day(iso), today = day(nowIso), tomorrow = day(new Date(t2(nowIso) + DAY).toISOString());
  const time = hhmm(iso, tz);
  if (d === today) return time;
  if (d === tomorrow) return (lang === 'ru' ? 'завтра ' : 'tomorrow ') + time;
  return `${d.slice(8, 10)}.${d.slice(5, 7)} ${time}`;
}

export type Sent = { kind: string; toId: string; text: string };

export const OUTDOOR_RE = /прогул|парк|футбол|тренировк|площадк|велосипед|пикник|пляж|бассейн|самокат|балкон|бельё|белье|walk|park|football|soccer|training|practice|playground|bike|picnic|beach|pool|scooter|balcony|laundry/i;
const OUTDOOR_SKILLS = new Set(['pickup_walk']);

export const isOutdoor = (t: Pick<Task, 'text' | 'skills'>) => OUTDOOR_RE.test(t.text) || t.skills.some(s => OUTDOOR_SKILLS.has(s));

/** Rain windows from the forecast (each slot is 3h). */
export function rainWindows(weather: WeatherData, threshold = 1): { from: string; to: string; mm: number }[] {
  return weather.forecast.filter(f => (f.rainMm ?? 0) > threshold && f.dt).map(f => ({ from: f.dt, to: plus(f.dt, 180), mm: f.rainMm ?? 0 }));
}
const inWindow = (iso: string, w: { from: string; to: string }) => iso >= w.from && iso < w.to;

/** First dry forecast slot after the rain, or tomorrow at the same time. */
export function dryAlternative(weather: WeatherData, dueAt: string, tz: string): string {
  const after = weather.forecast.filter(f => f.dt > dueAt && (f.rainMm ?? 0) <= 0.5).sort((a, b) => a.dt.localeCompare(b.dt))[0];
  if (after) {
    const h = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(after.dt)));
    if (h >= 7 && h <= 20) return after.dt;
  }
  return plus(dueAt, 24 * 60);
}

/** Run every autonomous scenario once. `weather` is passed in by tick so it is fetched once per hour. */
export async function runAutonomy(store: DomovoyStore, nowIso: string, opts: { weather?: WeatherData; force?: boolean } = {}): Promise<Sent[]> {
  const sent: Sent[] = [];
  if (opts.weather) {
    sent.push(...await weatherConflicts(store, nowIso, opts.weather, opts.force));
    sent.push(...await weatherChores(store, nowIso, opts.weather, opts.force));
  }
  sent.push(...await predictions(store, nowIso));
  sent.push(...await verification(store, nowIso));
  return sent;
}

// ──────────── 1. rain ∩ outdoor plans → reschedule through a checkpoint ────────────

export async function weatherConflicts(store: DomovoyStore, nowIso: string, weather: WeatherData, force = false): Promise<Sent[]> {
  const sent: Sent[] = [];
  const windows = rainWindows(weather);
  if (!windows.length) return sent;
  const [tasks, members, approvals] = await Promise.all([store.tasks(), store.members(), store.approvals()]);
  const tz = store.tz;
  const horizon = plus(nowIso, 12 * 60);
  const recent = approvals.filter(a => t2(a.createdAt) > t2(nowIso) - DAY);

  const open = tasks.filter(t => ['new', 'assigned', 'accepted', 'unassigned'].includes(t.status) && t.dueAt && t.dueAt > nowIso && t.dueAt < horizon && isOutdoor(t));
  for (const t of open) {
    const w = windows.find(w => inWindow(t.dueAt!, w));
    if (!w) continue;
    if (!force && recent.some(a => a.payload.taskId === t.id && (a.action === 'reschedule_task' || a.action === 'change_child_schedule'))) continue;

    // alternative slot: first dry slot, adjusted to when the executor is actually free
    let newDueAt = dryAlternative(weather, t.dueAt!, tz);
    const exec = members.find(m => m.id === t.assigneeId);
    let freeNote = { ru: '', en: '' };
    if (exec) {
      const avail = await checkCalendar({ memberId: exec.id, memberName: exec.name, calendarId: exec.calendarId, from: newDueAt, to: plus(newDueAt, 6 * 60) });
      const busyAt = avail.busySlots.find(s => newDueAt >= s.from && newDueAt < s.to) || exec.busy.find(b => newDueAt >= b.from && newDueAt < b.to);
      if (busyAt) {
        const free = avail.freeSlots.find(s => t2(s.to) - t2(s.from) >= t.minutes * 60_000);
        if (free) newDueAt = free.from;
      }
      freeNote = { ru: ` ${exec.name} в это время свободен(а) по календарю.`, en: ` ${exec.name} is free then according to the calendar.` };
    }

    const child = touchesChild(t, members);
    const whoRu = exec ? exec.name : 'пока без исполнителя', whoEn = exec ? exec.name : 'no executor yet';
    const about = t.aboutMemberId ? members.find(m => m.id === t.aboutMemberId)?.name : undefined;
    const reason = {
      ru: `🌧️ ${hhmm(w.from, tz)}–${hhmm(w.to, tz)} дождь (${w.mm} мм). ${about ? `У ${about}: ` : ''}«${t.text}» в ${fmtWhen(t.dueAt!, tz, nowIso, 'ru')} (${whoRu}).\nПеренести на ${fmtWhen(newDueAt, tz, nowIso, 'ru')}?${freeNote.ru}`,
      en: `🌧️ Rain ${hhmm(w.from, tz)}–${hhmm(w.to, tz)} (${w.mm} mm). ${about ? `${about}'s ` : ''}"${t.text}" is at ${fmtWhen(t.dueAt!, tz, nowIso, 'en')} (${whoEn}).\nMove it to ${fmtWhen(newDueAt, tz, nowIso, 'en')}?${freeNote.en}`,
    };
    const raincoat = {
      task: { text: say(store.lang, `Взять дождевик/зонт: ${t.text}`, `Take a raincoat/umbrella: ${t.text}`), minutes: 5, skills: [], kidSafe: true, dueAt: plus(t.dueAt!, -30) },
      assigneeId: t.assigneeId, authorId: t.authorId, origin: 'weather' as const,
    };
    await requestApproval(store, {
      action: child ? 'change_child_schedule' : 'reschedule_task',
      payload: { taskId: t.id, newDueAt, onReject: { action: 'create_task', payload: raincoat } },
      reason,
      fallback: { ru: 'оставлю время и напомню взять дождевик.', en: 'I keep the time and remind to take a raincoat.' },
      requestedBy: 'agent', authorId: t.authorId, taskId: t.id,
    }, nowIso);
    await store.saveInsight({ householdId: store.householdId, insightType: 'weather_conflict', targetMemberId: t.assigneeId, delivered: true, createdAt: nowIso,
      data: { taskId: t.id, text: t.text, rainFrom: w.from, rainTo: w.to, proposedAt: newDueAt } });
    sent.push({ kind: 'weather_conflict', toId: t.authorId, text: t.text });
  }

  // calendar busy-slots of family members that look outdoor (a child's training) and fall into the rain
  for (const m of members) {
    for (const b of m.busy) {
      if (!b.what || !OUTDOOR_RE.test(b.what) || !windows.some(w => inWindow(b.from, w))) continue;
      if (!force && recent.some(a => a.payload.busyKey === `${m.id}|${b.from}`)) continue;
      const w = windows.find(w => inWindow(b.from, w))!;
      const newFrom = dryAlternative(weather, b.from, tz);
      // represented as a task so the same reschedule/verify/report path applies
      const t: Task = { id: 't-' + randomUUID().slice(0, 8), authorId: members.find(x => x.isAdmin)?.id ?? m.id, text: b.what, dueAt: b.from, minutes: Math.max(15, Math.round((t2(b.to) - t2(b.from)) / 60_000)),
        skills: [], kidSafe: m.role === 'child', candidateIds: [m.id], declinedBy: [], status: 'accepted', assigneeId: m.id, assignedAt: nowIso, reminderLevel: 0, createdAt: nowIso, origin: 'weather', aboutMemberId: m.role === 'child' ? m.id : undefined };
      await store.saveTask(t);
      await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'created', details: { text: t.text, origin: 'weather', fromCalendar: true } });
      await requestApproval(store, {
        action: m.role === 'child' ? 'change_child_schedule' : 'reschedule_task',
        payload: { taskId: t.id, newDueAt: newFrom, busyKey: `${m.id}|${b.from}` },
        reason: { ru: `🌧️ ${hhmm(w.from, tz)}–${hhmm(w.to, tz)} дождь (${w.mm} мм), а у ${m.name} «${b.what}» в ${fmtWhen(b.from, tz, nowIso, 'ru')}. Перенести на ${fmtWhen(newFrom, tz, nowIso, 'ru')}?`,
          en: `🌧️ Rain ${hhmm(w.from, tz)}–${hhmm(w.to, tz)} (${w.mm} mm) and ${m.name} has "${b.what}" at ${fmtWhen(b.from, tz, nowIso, 'en')}. Move it to ${fmtWhen(newFrom, tz, nowIso, 'en')}?` },
        fallback: { ru: 'оставлю как есть и напомню взять дождевик.', en: 'I leave it and remind to take a raincoat.' },
        requestedBy: 'agent', authorId: t.authorId, taskId: t.id,
      }, nowIso);
      sent.push({ kind: 'weather_conflict', toId: m.id, text: b.what });
    }
  }
  return sent;
}

// ──────────── 2. low-risk weather chores → act, report, undo ────────────

const CHORE_FOR: Partial<Record<WeatherAlert['type'], { ru: string; en: string; skills: string[]; minutes: number; kidSafe: boolean }>> = {
  rain_coming:  { ru: 'Забрать бельё с балкона и закрыть окна', en: 'Bring the laundry in and close the windows', skills: ['laundry'], minutes: 10, kidSafe: true },
  storm:        { ru: 'Убрать вещи с балкона, закрыть окна', en: 'Secure balcony items, close windows', skills: [], minutes: 15, kidSafe: false },
  extreme_heat: { ru: 'Полить цветы и проверить воду у кота', en: 'Water the plants and check the cat\'s water', skills: ['water_plants'], minutes: 10, kidSafe: true },
  cold_snap:    { ru: 'Закрыть окна, достать тёплые вещи', en: 'Close windows, get warm clothes out', skills: [], minutes: 10, kidSafe: true },
};

export async function weatherChores(store: DomovoyStore, nowIso: string, weather: WeatherData, force = false): Promise<Sent[]> {
  const sent: Sent[] = [];
  const alerts = analyzeWeatherAlerts(weather);
  if (!alerts.length) return sent;
  const [tasks, members] = await Promise.all([store.tasks(), store.members()]);
  const today = nowIso.slice(0, 10);
  for (const a of alerts) {
    const spec = CHORE_FOR[a.type];
    if (!spec) continue;
    const lang = store.lang === 'en' ? 'en' : 'ru';
    const text = lang === 'ru' ? spec.ru : spec.en;
    if (!force && tasks.some(t => t.origin === 'weather' && t.createdAt.slice(0, 10) === today && t.text === text)) continue;
    const admin = members.find(m => m.isAdmin) ?? members[0];
    const rain = rainWindows(weather)[0];
    const dueAt = a.type === 'rain_coming' && rain ? plus(rain.from, -20) : plus(nowIso, 60);
    const res = await executeAction(store, 'create_task', { task: { text, minutes: spec.minutes, skills: spec.skills, kidSafe: spec.kidSafe, dueAt }, authorId: admin.id, origin: 'weather',
      decision: { level: 'act', confidence: 0.9, evidence: [`weather:${a.type}`], why: { ru: 'низкий риск, погодное правило семьи', en: 'low risk, household weather rule' } } }, nowIso);
    const exec = members.find(m => m.id === res.assigneeId);
    for (const m of members.filter(m => m.isAdmin)) {
      const msg = exec
        ? say(m.lang, `🤖 Сделал сам: ${a.taskSuggestion.ru.toLowerCase()} → создал «${text}» и назначил ${exec.name} (к ${hhmm(dueAt, store.tz)}). Проверю и отчитаюсь.`,
          `🤖 Acted on my own: ${a.taskSuggestion.en.toLowerCase()} → created "${text}" and assigned ${exec.name} (by ${hhmm(dueAt, store.tz)}). I will verify and report.`)
        : say(m.lang, `🌧️ ${a.taskSuggestion.ru} — но сейчас некому: создал «${text}» без исполнителя.`, `🌧️ ${a.taskSuggestion.en} — nobody available now: created "${text}" unassigned.`);
      await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'autonomous', text: msg, taskId: res.taskId as string });
      sent.push({ kind: 'autonomous_weather_chore', toId: m.id, text });
    }
    await store.event({ at: nowIso, taskId: res.taskId as string, actor: 'agent', type: 'autonomous_action', details: { kind: 'weather_chore', alert: a.type, assigneeId: res.assigneeId } });
  }
  return sent;
}

// ──────────── 3. recurring chores that are due again ────────────

export async function predictions(store: DomovoyStore, nowIso: string): Promise<Sent[]> {
  const sent: Sent[] = [];
  const [tasks, patterns, members, insights] = await Promise.all([store.tasks(), store.patterns(), store.members(), store.insights({ limit: 200 })]);
  const recurring = patterns.filter(p => p.patternType === 'recurring_task' && p.active && p.confidence >= 0.3);
  for (const p of recurring) {
    const text = String(p.data.text);
    const h = choreHistory(tasks, { text, skills: (p.data.skills as string[]) ?? [] });
    if (h.same.length < 3) continue;
    const times = h.same.map(t => t2(t.dueAt ?? t.createdAt)).sort((a, b) => a - b);
    const gaps = times.slice(1).map((x, i) => x - times[i]).filter(g => g > 0).sort((a, b) => a - b);
    if (!gaps.length) continue;
    const interval = gaps[Math.floor(gaps.length / 2)];
    if (interval < 12 * 3_600_000) continue;                         // several a day — not a prediction target
    const nextAt = times[times.length - 1] + interval;
    if (nextAt > t2(nowIso) + DAY || nextAt < t2(nowIso) - 6 * 3_600_000) continue;   // not due within the next 24h
    const alreadyOpen = h.same.some(t => !['done', 'cancelled'].includes(t.status) && t2(t.createdAt) > times[times.length - 1] - 1);
    if (alreadyOpen && h.last && !['done', 'cancelled'].includes(h.last.status)) continue;
    if (insights.some(i => i.insightType === 'recurring_prediction' && (i.data as any).text === text && t2(i.createdAt) > t2(nowIso) - interval / 2)) continue;

    const author = members.find(m => m.id === (h.last?.authorId ?? p.memberId)) ?? members.find(m => m.isAdmin)!;
    const executor = h.usualExecutor ?? h.last?.assigneeId;
    const chore = { text, skills: (p.data.skills as string[]) ?? [], authorId: author.id };
    const d = executor ? decideAutonomy({ tasks, patterns, members, chore, candidateId: executor }) : undefined;
    const execName = members.find(m => m.id === executor)?.name ?? '—';
    const dueAt = new Date(nextAt).toISOString();
    const minutes = h.last?.minutes ?? 20;
    await store.saveInsight({ householdId: store.householdId, insightType: 'recurring_prediction', targetMemberId: author.id, delivered: true, createdAt: nowIso,
      data: { text, executor, level: d?.level ?? 'remind', confidence: d?.confidence ?? 0, nextAt: dueAt } });

    if (d && d.level === 'act') {
      const res = await executeAction(store, 'create_task', { task: { text, minutes, skills: chore.skills, kidSafe: !!h.last?.kidSafe, dueAt }, assigneeId: executor, authorId: author.id, origin: 'prediction', decision: d }, nowIso);
      await store.event({ at: nowIso, taskId: res.taskId as string, actor: 'agent', type: 'autonomous_action', details: { kind: 'prediction', text, assigneeId: executor, confidence: d.confidence } });
      await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'autonomous', taskId: res.taskId as string,
        text: say(author.lang, `🤖 Сделал сам: «${text}» снова пора (обычно раз в ${Math.round(interval / DAY) || 1} дн.). Назначил ${execName}: ${d.why.ru}`,
          `🤖 Acted on my own: "${text}" is due again (usually every ${Math.round(interval / DAY) || 1} d). Assigned ${execName}: ${d.why.en}`) });
      sent.push({ kind: 'prediction_act', toId: author.id, text });
    } else if (d && d.level === 'ask') {
      await requestApproval(store, { action: 'create_task',
        payload: { task: { text, minutes, skills: chore.skills, kidSafe: !!h.last?.kidSafe, dueAt }, assigneeId: executor, authorId: author.id, origin: 'prediction', decision: d },
        reason: { ru: `🔁 Обычно в это время вы просите «${text}». Создать и назначить ${execName}? ${d.why.ru}`, en: `🔁 Around now you usually ask for "${text}". Create it and assign ${execName}? ${d.why.en}` },
        requestedBy: 'agent', authorId: author.id }, nowIso);
      sent.push({ kind: 'prediction_ask', toId: author.id, text });
    } else {
      await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'info',
        text: say(author.lang, `🔁 Напоминаю: обычно в это время — «${text}». Напишите мне, если нужно — пока я только напоминаю (мало истории, кто это делает).`,
          `🔁 Reminder: around now it is usually "${text}". Tell me if you need it — for now I only remind (not enough history on who does it).`) });
      sent.push({ kind: 'prediction_remind', toId: author.id, text });
    }
  }
  return sent;
}

// ──────────── 4. did it actually happen? ────────────

export async function verification(store: DomovoyStore, nowIso: string): Promise<Sent[]> {
  const sent: Sent[] = [];
  const [tasks, members, events] = await Promise.all([store.tasks(), store.members(), store.events()]);
  for (const t of tasks) {
    if (!t.agentManaged || !t.verifyAt || !['assigned', 'accepted'].includes(t.status) || !t.assigneeId) continue;
    const m = members.find(x => x.id === t.assigneeId); if (!m) continue;
    if (!t.verifyAsked && t.verifyAt <= nowIso) {
      t.verifyAsked = true; await store.saveTask(t);
      await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'verification_asked', details: { member: m.id } });
      await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'verification', taskId: t.id,
        text: say(m.lang, `🔎 Проверяю: «${t.text}» — сделано?`, `🔎 Checking: "${t.text}" — done?`) });
      sent.push({ kind: 'verification', toId: m.id, text: t.text });
      continue;
    }
    // no answer 90 min after the question → the agent does not wait silently: hand over + tell the author
    if (t.verifyAsked && t2(nowIso) - t2(t.verifyAt) >= 90 * 60_000 && !events.some(e => e.taskId === t.id && e.type === 'info' && e.details?.kind === 'verify_escalated')) {
      await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'info', details: { kind: 'verify_escalated', member: m.id } });
      const author = members.find(x => x.id === t.authorId);
      try { await respond(store, t.id, m.id, 'decline', nowIso); } catch { /* already moved */ }
      if (author && author.id !== m.id) {
        await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'info', taskId: t.id,
          text: say(author.lang, `⚠️ ${m.name} не подтвердил(а) «${t.text}» — передаю дальше и держу на контроле.`, `⚠️ ${m.name} did not confirm "${t.text}" — handing it over and keeping an eye on it.`) });
        sent.push({ kind: 'verify_escalated', toId: author.id, text: t.text });
      }
    }
  }
  return sent;
}

/** Called when an agent-managed task is closed: report to the author that the loop is closed. */
export async function reportLoopClosed(store: DomovoyStore, t: Task, doneBy: Member, nowIso: string): Promise<void> {
  if (!t.agentManaged) return;
  const members = await store.members();
  const author = members.find(m => m.id === t.authorId);
  await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'loop_closed', details: { origin: t.origin, verified: !!t.verifyAsked, doneBy: doneBy.id } });
  await store.saveInsight({ householdId: store.householdId, insightType: 'loop_closed', targetMemberId: t.authorId, delivered: true, createdAt: nowIso, data: { taskId: t.id, text: t.text, origin: t.origin } });
  if (!author || author.id === doneBy.id) return;
  const originRu: Record<string, string> = { weather: 'погодное предложение', prediction: 'предсказание по истории', approval: 'ваше одобрение', followup: 'контроль' };
  const originEn: Record<string, string> = { weather: 'the weather proposal', prediction: 'the history-based prediction', approval: 'your approval', followup: 'the follow-up' };
  await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'report', taskId: t.id,
    text: say(author.lang, `✅ Цикл закрыт: «${t.text}» — ${doneBy.name} подтвердил(а) в ${hhmm(nowIso, store.tz)}. ${originRu[t.origin ?? ''] ? 'Сработало: ' + originRu[t.origin!] + '.' : ''}`,
      `✅ Loop closed: "${t.text}" — ${doneBy.name} confirmed at ${hhmm(nowIso, store.tz)}. ${originEn[t.origin ?? ''] ? 'It worked: ' + originEn[t.origin!] + '.' : ''}`) });
}
