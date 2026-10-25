/**
 * Pillar 1: Memory & Learning
 *
 * Analyzes events history to detect behavioral patterns:
 *  - decline_time:    member declines tasks at specific hours
 *  - decline_skill:   member declines tasks requiring certain skills
 *  - preferred_time:  member completes tasks faster at certain hours
 *  - recurring_task:  frequently repeated task text/skill combo
 *  - response_speed:  average time between assignment and accept/decline
 *  - completion_rate: done / (done + declined) ratio over the last 30 days
 *  - pair_affinity:   two members work well together (fast accepts, no conflicts)
 *  - pair_conflict:   two members frequently have friction
 *
 * The dispatch prompt receives a compact summary of relevant patterns
 * so the LLM can make smarter assignment decisions.
 */
import type { DomovoyStore } from './store';
import type { Member, Pattern, PatternType, Task, TaskEvent } from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Extract hour (0-23) in the household timezone */
function hourIn(iso: string, tz: string): number {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(iso)));
}

/** Run full pattern detection for a household. Call after tick or periodically. */
export async function detectPatterns(store: DomovoyStore, nowIso: string): Promise<Pattern[]> {
  const [members, tasks, events] = await Promise.all([store.members(), store.tasks(), store.events()]);
  const tz = store.tz;
  const now = new Date(nowIso).getTime();
  const thirtyDaysAgo = new Date(now - 30 * DAY).toISOString();
  const recentEvents = events.filter(e => e.at >= thirtyDaysAgo);
  const recentTasks = tasks.filter(t => t.createdAt >= thirtyDaysAgo);
  const detected: Pattern[] = [];

  for (const m of members) {
    // ── decline_time: at which hours does this member decline? ──
    const declineEvents = recentEvents.filter(e =>
      (e.type === 'declined' && e.actor === m.id) ||
      (e.type === 'timeout' && e.details?.member === m.id)
    );
    if (declineEvents.length >= 2) {
      const hours: Record<number, number> = {};
      for (const e of declineEvents) { const h = hourIn(e.at, tz); hours[h] = (hours[h] ?? 0) + 1; }
      const peakHours = Object.entries(hours).filter(([, c]) => c >= 2).map(([h]) => +h);
      if (peakHours.length) {
        detected.push(makePattern(store.householdId, m.id, 'decline_time', {
          hours: peakHours,
          counts: Object.fromEntries(peakHours.map(h => [h, hours[h]])),
        }, declineEvents.length, declineEvents[0].at, nowIso));
      }
    }

    // ── decline_skill: which skills does this member avoid? ──
    const declinedTaskIds = new Set(declineEvents.map(e => e.taskId));
    const declinedSkills: Record<string, number> = {};
    for (const t of recentTasks) {
      if (declinedTaskIds.has(t.id)) {
        for (const s of t.skills) declinedSkills[s] = (declinedSkills[s] ?? 0) + 1;
      }
    }
    const avoidedSkills = Object.entries(declinedSkills).filter(([, c]) => c >= 2);
    if (avoidedSkills.length) {
      detected.push(makePattern(store.householdId, m.id, 'decline_skill', {
        skills: Object.fromEntries(avoidedSkills),
      }, avoidedSkills.reduce((s, [, c]) => s + c, 0), declineEvents[0]?.at ?? nowIso, nowIso));
    }

    // ── preferred_time: fastest completion hours ──
    const doneByM = recentTasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.assignedAt && t.doneAt);
    if (doneByM.length >= 3) {
      const hourSpeed: Record<number, number[]> = {};
      for (const t of doneByM) {
        const h = hourIn(t.assignedAt!, tz);
        const mins = (new Date(t.doneAt!).getTime() - new Date(t.assignedAt!).getTime()) / 60_000;
        if (mins > 0 && mins < 600) { (hourSpeed[h] ??= []).push(mins); }
      }
      const avgByHour = Object.entries(hourSpeed)
        .filter(([, v]) => v.length >= 2)
        .map(([h, v]) => ({ hour: +h, avgMin: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
        .sort((a, b) => a.avgMin - b.avgMin);
      if (avgByHour.length) {
        detected.push(makePattern(store.householdId, m.id, 'preferred_time', {
          bestHours: avgByHour.slice(0, 3),
        }, doneByM.length, doneByM[0].createdAt, nowIso));
      }
    }

    // ── response_speed: avg time to respond ──
    const assignedEvents = recentEvents.filter(e => e.type === 'assigned' && e.details?.to === m.id);
    const responseEvents = recentEvents.filter(e => (e.type === 'accepted' || e.type === 'declined') && e.actor === m.id);
    if (assignedEvents.length >= 3) {
      const speeds: number[] = [];
      for (const ae of assignedEvents) {
        const resp = responseEvents.find(re => re.taskId === ae.taskId && re.at > ae.at);
        if (resp) speeds.push((new Date(resp.at).getTime() - new Date(ae.at).getTime()) / 60_000);
      }
      if (speeds.length >= 2) {
        const avgMin = Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length);
        detected.push(makePattern(store.householdId, m.id, 'response_speed', {
          avgMinutes: avgMin,
          medianMinutes: Math.round(speeds.sort((a, b) => a - b)[Math.floor(speeds.length / 2)]),
          sampleSize: speeds.length,
        }, speeds.length, assignedEvents[0].at, nowIso));
      }
    }

    // ── completion_rate: done vs declined ratio ──
    const done = recentTasks.filter(t => t.assigneeId === m.id && t.status === 'done').length;
    const declined = declineEvents.length;
    if (done + declined >= 3) {
      const rate = done / (done + declined);
      detected.push(makePattern(store.householdId, m.id, 'completion_rate', {
        done, declined, rate: Math.round(rate * 100) / 100,
      }, done + declined, thirtyDaysAgo, nowIso));
    }
  }

  // ── recurring_task: frequently repeated task texts ──
  const taskTexts: Record<string, { count: number; authorId: string; skills: string[] }> = {};
  for (const t of recentTasks) {
    const key = t.text.toLowerCase().trim();
    if (!taskTexts[key]) taskTexts[key] = { count: 0, authorId: t.authorId, skills: t.skills };
    taskTexts[key].count++;
  }
  for (const [text, info] of Object.entries(taskTexts)) {
    if (info.count >= 3) {
      detected.push(makePattern(store.householdId, info.authorId, 'recurring_task', {
        text, skills: info.skills, count: info.count,
      }, info.count, thirtyDaysAgo, nowIso));
    }
  }

  // ── pair_affinity / pair_conflict ──
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      // Tasks A assigned to B and vice versa
      const ab = recentTasks.filter(t => t.authorId === a.id && t.assigneeId === b.id && t.status === 'done').length;
      const ba = recentTasks.filter(t => t.authorId === b.id && t.assigneeId === a.id && t.status === 'done').length;
      const abDecl = recentEvents.filter(e => e.type === 'declined' && e.actor === b.id && recentTasks.find(t => t.id === e.taskId)?.authorId === a.id).length;
      const baDecl = recentEvents.filter(e => e.type === 'declined' && e.actor === a.id && recentTasks.find(t => t.id === e.taskId)?.authorId === b.id).length;
      const totalDone = ab + ba;
      const totalDecl = abDecl + baDecl;
      if (totalDone >= 3 && totalDecl === 0) {
        detected.push(makePattern(store.householdId, a.id, 'pair_affinity', {
          partnerId: b.id, partnerName: b.name, doneCount: totalDone,
        }, totalDone, thirtyDaysAgo, nowIso));
      }
      if (totalDecl >= 3) {
        detected.push(makePattern(store.householdId, a.id, 'pair_conflict', {
          partnerId: b.id, partnerName: b.name, declineCount: totalDecl,
        }, totalDecl, thirtyDaysAgo, nowIso));
      }
    }
  }

  // Persist detected patterns
  for (const p of detected) {
    const existing = (await store.patterns(p.memberId)).find(x =>
      x.patternType === p.patternType && JSON.stringify(x.data) === JSON.stringify(p.data)
    );
    if (existing) {
      existing.lastSeen = nowIso;
      existing.observedCount = p.observedCount;
      existing.confidence = Math.min(1, p.observedCount / 10);
      await store.savePattern(existing);
    } else {
      p.confidence = Math.min(1, p.observedCount / 10);
      await store.savePattern(p);
    }
  }

  return detected;
}

/** Build a compact pattern summary for the dispatch prompt */
export async function patternContext(store: DomovoyStore): Promise<string> {
  const patterns = await store.patterns();
  if (!patterns.length) return '';
  const members = await store.members();
  const byMember = new Map<string, Pattern[]>();
  for (const p of patterns.filter(x => x.active && x.confidence >= 0.3)) {
    (byMember.get(p.memberId) ?? (byMember.set(p.memberId, []), byMember.get(p.memberId)!)).push(p);
  }

  const lines: string[] = ['\n## Behavioral Patterns (learned from history)'];
  for (const [mid, pats] of byMember) {
    const m = members.find(x => x.id === mid);
    if (!m) continue;
    lines.push(`\n${m.name} (${mid}):`);
    for (const p of pats) {
      switch (p.patternType) {
        case 'decline_time': lines.push(`  - Often declines tasks at hours: ${(p.data.hours as number[]).join(', ')} (${p.observedCount} observed)`); break;
        case 'decline_skill': lines.push(`  - Avoids skills: ${Object.keys(p.data.skills as Record<string, number>).join(', ')}`); break;
        case 'preferred_time': lines.push(`  - Fastest at hours: ${(p.data.bestHours as any[]).map(h => `${h.hour}:00 (~${h.avgMin}min)`).join(', ')}`); break;
        case 'response_speed': lines.push(`  - Avg response: ${p.data.avgMinutes}min`); break;
        case 'completion_rate': lines.push(`  - Completion rate: ${Math.round((p.data.rate as number) * 100)}% (${p.data.done} done / ${p.data.declined} declined)`); break;
        case 'pair_affinity': lines.push(`  - Works well with ${p.data.partnerName} (${p.data.doneCount} tasks completed together)`); break;
        case 'pair_conflict': lines.push(`  - Friction with ${p.data.partnerName} (${p.data.declineCount} mutual declines)`); break;
        case 'recurring_task': lines.push(`  - Recurring: "${p.data.text}" (${p.data.count}x)`); break;
      }
    }
  }
  return lines.join('\n');
}

function makePattern(householdId: string, memberId: string, patternType: PatternType, data: Record<string, unknown>, observedCount: number, firstSeen: string, lastSeen: string): Pattern {
  return { householdId, memberId, patternType, data, confidence: Math.min(1, observedCount / 10), observedCount, firstSeen, lastSeen, active: true };
}
