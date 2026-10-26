import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/** GET /api/domovoy/logout — drop the panel session and go to the login page. */
export async function GET(req: Request) {
  const jar = await cookies();
  jar.set('dm_token', '', { httpOnly: true, secure: new URL(req.url).protocol === 'https:', sameSite: 'lax', path: '/domovoy', maxAge: 0 });
  return NextResponse.redirect(new URL('/login/domovoy', req.url));
}
