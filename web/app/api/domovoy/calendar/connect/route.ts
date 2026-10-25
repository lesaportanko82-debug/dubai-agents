import { NextResponse } from 'next/server';
import { loadRootEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /api/domovoy/calendar/connect?member=<id>&household=<id>
 *
 * Redirects the user to Google OAuth consent screen.
 * After consent, Google redirects back to /api/domovoy/calendar/callback.
 */
export async function GET(req: Request) {
  loadRootEnv();

  const url = new URL(req.url);
  const memberId = url.searchParams.get('member');
  const householdId = url.searchParams.get('household');

  if (!memberId || !householdId) {
    return NextResponse.json({ error: 'missing member or household' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) {
    return new NextResponse(
      '<html><body style="font-family:sans-serif;padding:40px;text-align:center">' +
      '<h2>⚠️ Google Calendar не настроен</h2>' +
      '<p>Google Calendar is not configured yet. Ask the admin to set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.</p>' +
      '</body></html>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  // Build callback URL from the current host
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'dubai-agents.vercel.app';
  const callbackUrl = `https://${host}/api/domovoy/calendar/callback`;

  // State carries member + household info for the callback
  const state = Buffer.from(JSON.stringify({ memberId, householdId })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
