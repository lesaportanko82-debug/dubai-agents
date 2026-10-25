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
