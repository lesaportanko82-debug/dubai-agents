/**
 * Household profile — the digital twin of the home the agent acts in.
 *
 * Not a form. Facts arrive three ways: stated once when the agent actually needs them ("where do I
 * deliver?" → remembered forever), learned from use (a merchant after the first paid order), or set
 * with /profile. Each fact has an access level, and the agent's prompt only ever receives what the
 * current person may see; medical facts are sealed with a separate key when PROFILE_KEY is set and
 * are fetched only on demand through get_profile, never pasted into every prompt.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { Lang, Member } from './types';

export type FactKind = 'place' | 'person' | 'rule' | 'recurring' | 'other';
/** family: everyone in the household · adults: adults, elders and admins · owner: the person it is about + admins */
export type FactAccess = 'family' | 'adults' | 'owner';

export interface ProfileFact {
  householdId: string;
  key: string;                 // 'home', 'school:masha', 'allergy:son', 'shoe_size:son', 'quiet_hours'
  kind: FactKind;
  value: string;               // plaintext in memory; sealed at rest when sensitive and PROFILE_KEY is set
  aboutMemberId?: string;
  access: FactAccess;
  source: 'stated' | 'learned';
  createdBy: string;           // member id or 'agent'
  createdAt: string;
  updatedAt: string;
  sealed?: boolean;
}

export const SENSITIVE_KEY_RE = /^(allergy|allergies|health|medication|medicine|diagnosis|doctor|blood|condition)(:|$)/i;
const KEY_RE = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;

export const normKey = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_:]/g, '');
export const isValidKey = (k: string) => KEY_RE.test(k) && k.length <= 60;

/** Default access: medical → adults; anything about a specific person → owner; places and rules → family. */
export function defaultAccess(key: string, aboutMemberId?: string): FactAccess {
  if (SENSITIVE_KEY_RE.test(key)) return 'adults';
  if (aboutMemberId) return 'owner';
  return 'family';
}

export function canSee(f: ProfileFact, m: Member): boolean {
  if (m.isAdmin) return true;
  if (f.access === 'family') return true;
  if (f.access === 'adults') return m.role === 'adult' || m.role === 'elder';
  return f.aboutMemberId === m.id;
}

/** Who may write a fact: admins anything; others only facts about themselves or family-level places. */
export function canWrite(key: string, aboutMemberId: string | undefined, access: FactAccess, m: Member): boolean {
  if (m.isAdmin) return true;
  if (m.role === 'child' || m.role === 'helper') return aboutMemberId === m.id && !SENSITIVE_KEY_RE.test(key);
  return !aboutMemberId || aboutMemberId === m.id || access === 'family';
}

// ──────────── sealing (AES-256-GCM with a key separate from the database) ────────────

function sealKey(): Buffer | undefined {
  const k = process.env.PROFILE_KEY?.trim();
  return k ? createHash('sha256').update(k).digest() : undefined;
}
export function seal(plain: string): { value: string; sealed: boolean } {
  const key = sealKey();
  if (!key) return { value: plain, sealed: false };
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { value: `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`, sealed: true };
}
export function unseal(value: string, sealed?: boolean): string {
  if (!sealed) return value;
  const key = sealKey();
  if (!key) return '[sealed — PROFILE_KEY not configured]';
  try {
    const [, iv, tag, data] = value.split(':');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return '[sealed — cannot decrypt]'; }
}

// ──────────── operations ────────────

export interface RememberInput { key: string; value: string; kind?: FactKind; aboutMemberId?: string; access?: FactAccess; source?: 'stated' | 'learned' }

export async function rememberFact(store: DomovoyStore, by: Member | 'agent', input: RememberInput, nowIso: string): Promise<ProfileFact> {
  const key = normKey(input.key);
  if (!isValidKey(key)) throw new Error('bad key: use letters, digits, _ and one ":" (e.g. school:masha)');
  let access = input.access ?? defaultAccess(key, input.aboutMemberId);
  if (SENSITIVE_KEY_RE.test(key) && access === 'family') access = 'adults';   // medical facts are never family-wide, whatever the caller asked
  if (by !== 'agent' && !canWrite(key, input.aboutMemberId, access, by)) throw new Error(`${by.name} may not set ${key}`);
  const existing = (await store.profile()).find(f => f.key === key);
  const f: ProfileFact = {
    householdId: store.householdId, key, kind: input.kind ?? (existing?.kind ?? inferKind(key)),
    value: input.value.trim().slice(0, 400), aboutMemberId: input.aboutMemberId ?? existing?.aboutMemberId,
    access, source: input.source ?? 'stated', createdBy: by === 'agent' ? 'agent' : by.id,
    createdAt: existing?.createdAt ?? nowIso, updatedAt: nowIso,
  };
  await store.saveFact(f);
  await store.event({ at: nowIso, taskId: 'profile', actor: f.createdBy, type: 'info', details: { kind: 'profile_set', key, access, sensitive: SENSITIVE_KEY_RE.test(key) } });
  return f;
}

export function inferKind(key: string): FactKind {
  if (/^(home|school|kindergarten|work|clinic|shop|store|gym|club|pool|address)/.test(key)) return 'place';
  if (/^(allergy|health|medication|size|shoe_size|clothes_size|birthday|phone|emergency)/.test(key)) return 'person';
  if (/^(quiet_hours|rule|limit|allowed|curfew)/.test(key)) return 'rule';
  if (/^(weekly|monthly|subscription|recurring)/.test(key)) return 'recurring';
  return 'other';
}

export async function visibleFacts(store: DomovoyStore, m: Member, filter?: { kind?: FactKind; aboutMemberId?: string }): Promise<ProfileFact[]> {
  let facts = (await store.profile()).filter(f => canSee(f, m));
  if (filter?.kind) facts = facts.filter(f => f.kind === filter.kind);
  if (filter?.aboutMemberId) facts = facts.filter(f => f.aboutMemberId === filter.aboutMemberId);
  return facts;
}

/** The one place the agent needs most often. */
export async function homeAddress(store: DomovoyStore): Promise<string | undefined> {
  return (await store.profile()).find(f => f.key === 'home')?.value;
}

/** Short prompt context for the author: non-sensitive facts they may see, places first. Medical facts stay behind get_profile. */
export async function profileContext(store: DomovoyStore, m: Member): Promise<string> {
  const facts = (await visibleFacts(store, m)).filter(f => !SENSITIVE_KEY_RE.test(f.key));
  const all = await store.profile();
  if (!all.length) return '\n## Household profile\nEmpty. When you need a fact the family has not given (delivery address, a school\'s location, a child\'s shoe size), ask the author ONCE in your summary; when they answer, store it with remember_fact.';
  const lines = ['\n## Household profile (what this person may see; ask once and remember_fact for anything missing)'];
  for (const f of facts.sort((a, b) => a.kind.localeCompare(b.kind)).slice(0, 30)) lines.push(`- ${f.key}${f.aboutMemberId ? ` (about ${f.aboutMemberId})` : ''}: ${f.value}`);
  const hidden = all.length - facts.length;
  if (hidden) lines.push(`- (${hidden} more facts need get_profile: medical / restricted)`);
  return lines.join('\n');
}

export function formatProfile(facts: ProfileFact[], members: Member[], lang: Lang): string {
  if (!facts.length) return lang === 'ru'
    ? '📇 Профиль семьи пуст. Я спрошу нужное сам, когда понадобится, или задайте: /profile set home Dubai Marina, Marina Gate 1, apt 1204'
    : '📇 The family profile is empty. I will ask for what I need when I need it, or set it: /profile set home Dubai Marina, Marina Gate 1, apt 1204';
  const icon: Record<FactKind, string> = { place: '📍', person: '👤', rule: '📏', recurring: '🔁', other: '•' };
  const lock: Record<FactAccess, string> = { family: '', adults: ' 🔒', owner: ' 🔐' };
  const name = (id?: string) => id ? ` (${members.find(m => m.id === id)?.name ?? id})` : '';
  const lines = [lang === 'ru' ? '📇 Профиль семьи (🔒 только взрослые, 🔐 только владелец и родители):' : '📇 Family profile (🔒 adults only, 🔐 owner and parents only):'];
  for (const f of [...facts].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))) {
    lines.push(`${icon[f.kind]} ${f.key}${name(f.aboutMemberId)}: ${f.value}${lock[f.access]}${f.source === 'learned' ? (lang === 'ru' ? ' · выучено' : ' · learned') : ''}`);
  }
  lines.push(lang === 'ru' ? '\n/profile set <ключ> <значение> · /profile forget <ключ> · ключи: home, school:masha, allergy:son, shoe_size:son, quiet_hours' : '\n/profile set <key> <value> · /profile forget <key> · keys: home, school:masha, allergy:son, shoe_size:son, quiet_hours');
  return lines.join('\n');
}
