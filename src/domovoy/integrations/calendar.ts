/**
 * Google Calendar integration for Domovoy.
 *
 * Checks family members' calendar availability before task assignment.
 * Uses Google Calendar API with a service account or OAuth token.
 * When GOOGLE_CALENDAR_CREDENTIALS is not set, returns demo data.
 *
 * Each member can have a `calendarId` field (email or calendar ID).
 * The agent uses this to check busy/free status before assigning tasks.
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;      // ISO
  end: string;        // ISO
  allDay: boolean;
  location?: string;
}

export interface CalendarAvailability {
  memberId: string;
  memberName: string;
  calendarId?: string;
  events: CalendarEvent[];     // events in the query window
  busySlots: { from: string; to: string }[];
  freeSlots: { from: string; to: string }[];
  isBusyNow: boolean;
  nextFreeAt?: string;         // ISO — when member becomes free
}

const DEMO_EVENTS: Record<string, CalendarEvent[]> = {
  mum: [
    { id: 'e1', summary: 'Team meeting', start: '', end: '', allDay: false },
    { id: 'e2', summary: 'Lunch with client', start: '', end: '', allDay: false },
  ],
  dad: [
    { id: 'e3', summary: 'Project review', start: '', end: '', allDay: false },
  ],
};

/** Check calendar availability for a member within a time window. */
export async function checkCalendar(opts: {
  memberId: string;
  memberName: string;
  calendarId?: string;
  from: string;  // ISO
  to: string;    // ISO
}): Promise<CalendarAvailability> {
  const creds = process.env.GOOGLE_CALENDAR_CREDENTIALS;

  if (!creds || !opts.calendarId) {
    // Demo mode: return realistic busy slots
    return generateDemoAvailability(opts);
  }

  try {
    // Real Google Calendar API call
    const token = await getAccessToken(creds);
    const calId = encodeURIComponent(opts.calendarId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?` +
      `timeMin=${encodeURIComponent(opts.from)}&timeMax=${encodeURIComponent(opts.to)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=20`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`Calendar API error for ${opts.memberName}: ${res.status}`);
      return emptyAvailability(opts);
    }

    const data = await res.json() as any;
    const events: CalendarEvent[] = (data.items ?? []).map((e: any) => ({
      id: e.id,
      summary: e.summary ?? '(busy)',
      start: e.start?.dateTime ?? e.start?.date ?? '',
      end: e.end?.dateTime ?? e.end?.date ?? '',
      allDay: !!e.start?.date,
      location: e.location,
    }));

    return buildAvailability(opts, events);
  } catch (err) {
    console.error(`Calendar error for ${opts.memberName}:`, err);
    return emptyAvailability(opts);
  }
}

/** Check all family members' availability in a window. */
export async function checkFamilyCalendars(members: { id: string; name: string; calendarId?: string }[], from: string, to: string): Promise<CalendarAvailability[]> {
  return Promise.all(
    members.map(m => checkCalendar({ memberId: m.id, memberName: m.name, calendarId: m.calendarId, from, to }))
  );
}

// ── Internal helpers ──

function buildAvailability(opts: { memberId: string; memberName: string; from: string; to: string }, events: CalendarEvent[]): CalendarAvailability {
  const busySlots = events
    .filter(e => !e.allDay && e.start && e.end)
    .map(e => ({ from: e.start, to: e.end }));

  const freeSlots = computeFreeSlots(opts.from, opts.to, busySlots);
  const now = new Date().toISOString();
  const isBusyNow = busySlots.some(s => s.from <= now && s.to > now);
  const nextFree = isBusyNow
    ? busySlots.filter(s => s.to > now).sort((a, b) => a.to.localeCompare(b.to))[0]?.to
    : undefined;

  return {
    memberId: opts.memberId,
    memberName: opts.memberName,
    events,
    busySlots,
    freeSlots,
    isBusyNow,
    nextFreeAt: nextFree,
  };
}

function computeFreeSlots(from: string, to: string, busy: { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = [...busy].sort((a, b) => a.from.localeCompare(b.from));
  const free: { from: string; to: string }[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.from > cursor) free.push({ from: cursor, to: b.from });
    if (b.to > cursor) cursor = b.to;
  }
  if (cursor < to) free.push({ from: cursor, to });
  return free;
}

function emptyAvailability(opts: { memberId: string; memberName: string }): CalendarAvailability {
  return { memberId: opts.memberId, memberName: opts.memberName, events: [], busySlots: [], freeSlots: [], isBusyNow: false };
}

function generateDemoAvailability(opts: { memberId: string; memberName: string; from: string; to: string }): CalendarAvailability {
  const fromDate = new Date(opts.from);
  const demoKey = opts.memberId.includes('mum') ? 'mum' : opts.memberId.includes('dad') ? 'dad' : '';
  const templates = DEMO_EVENTS[demoKey] ?? [];

  const events: CalendarEvent[] = templates.map((e, i) => {
    const start = new Date(fromDate.getTime() + (i + 1) * 2 * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    return { ...e, start: start.toISOString(), end: end.toISOString() };
  });

  return buildAvailability(opts, events);
}

async function getAccessToken(credsJson: string): Promise<string> {
  // Support both service account JSON and direct access token
  try {
    const creds = JSON.parse(credsJson);
    if (creds.access_token) return creds.access_token;
    // For service accounts, would use JWT here
    // For demo/MVP, we support passing a raw access token
    if (creds.type === 'service_account') {
      // In production: implement JWT → access token exchange
      // For now, fall back to demo mode
      throw new Error('Service account JWT not yet implemented');
    }
    return creds.token ?? '';
  } catch {
    // Treat as raw access token
    return credsJson;
  }
}
