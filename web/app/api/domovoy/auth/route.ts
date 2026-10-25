import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDomovoyDb } from '@/lib/domovoy-server';
import { loadRootEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

const COOKIE = 'dm_token';

/** GET /api/domovoy/auth?token=<magic-link token> — validates and sets a cookie, then redirects to /domovoy */
export async function GET(req: Request) {
  loadRootEnv();
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 });

  const db = getDomovoyDb();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const session = await db.panelSession(token);
  if (!session) return NextResponse.json({ error: 'invalid or expired token' }, { status: 401 });

  // Set cookie and redirect
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/domovoy',
    maxAge: 30 * 24 * 3600, // 30 days
  });

  return NextResponse.redirect(new URL('/domovoy', req.url));
}

/**
 * POST /api/domovoy/auth
 * Body: { pin: "123456" } → returns { household, members } for the login page to pick a member
 * Body: { pin: "123456", memberId: "m_abc" } → creates a panel session, sets cookie, returns { ok: true }
 */
export async function POST(req: Request) {
  loadRootEnv();
  const db = getDomovoyDb();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body?.pin || typeof body.pin !== 'string') {
    return NextResponse.json({ error: 'missing pin' }, { status: 400 });
  }

  const pin = body.pin.trim();
  const household = await db.householdByPin(pin);
  if (!household) {
    return NextResponse.json({ error: 'wrong_pin' }, { status: 401 });
  }

  // Step 1: just PIN → return household + members list (for member picker)
  if (!body.memberId) {
    const store = db.store(household);
    const members = (await store.members()).map(m => ({
      id: m.id, name: m.name, role: m.role, age: m.age, lang: m.lang, isAdmin: m.isAdmin,
    }));
    return NextResponse.json({ household: { id: household.id, name: household.name }, members });
  }

  // Step 2: PIN + memberId → create session + set cookie
  const memberId = String(body.memberId);
  const store = db.store(household);
  const members = await store.members();
  const member = members.find(m => m.id === memberId);
  if (!member) {
    return NextResponse.json({ error: 'unknown member' }, { status: 400 });
  }

  const token = await db.createPanelSession(household.id, member.id);

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/domovoy',
    maxAge: 30 * 24 * 3600,
  });

  return NextResponse.json({ ok: true });
}
