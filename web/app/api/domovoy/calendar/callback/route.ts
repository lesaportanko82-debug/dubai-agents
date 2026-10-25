import { NextResponse } from 'next/server';
import { loadRootEnv } from '@/lib/env';
import { getDomovoyDb } from '@/lib/domovoy-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/domovoy/calendar/callback?code=<auth_code>&state=<base64url json>
 *
 * Google redirects here after user grants calendar access.
 * We exchange the code for tokens and store them so check_calendar works.
 */
export async function GET(req: Request) {
  loadRootEnv();

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return new NextResponse(htmlPage(
      '❌ Доступ отклонён / Access denied',
      'Вы отклонили доступ к Google Calendar. Попробуйте снова через /connect в боте.<br>' +
      'You denied access to Google Calendar. Try again via /connect in the bot.'
    ), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  if (!code || !stateRaw) {
    return NextResponse.json({ error: 'missing code or state' }, { status: 400 });
  }

  let state: { memberId: string; householdId: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString());
  } catch {
    return NextResponse.json({ error: 'invalid state' }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 503 });
  }

  // Exchange code for tokens
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'dubai-agents.vercel.app';
  const redirectUri = `https://${host}/api/domovoy/calendar/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('Google token exchange failed:', err);
    return new NextResponse(htmlPage(
      '❌ Ошибка авторизации / Auth error',
      'Не удалось получить токен. Попробуйте снова через /connect.<br>Failed to get token. Try again via /connect.'
    ), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };

  // Get user's primary calendar email
  let calendarEmail = 'primary';
  try {
    const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (calRes.ok) {
      const cal = await calRes.json() as { id?: string };
      if (cal.id) calendarEmail = cal.id;
    }
  } catch { /* use 'primary' */ }

  // Store the token — try Supabase first, fallback to env-based storage
  const db = getDomovoyDb();
  if (db) {
    try {
      await db.saveCalendarToken(state.householdId, state.memberId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? '',
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        calendarEmail,
      });
    } catch (err) {
      console.error('Failed to save calendar token:', err);
      // Continue — user still gets success page
    }

    // Update member's calendarId
    try {
      const household = await db.household(state.householdId);
      if (household) {
        const store = db.store(household);
        const members = await store.members();
        const member = members.find(m => m.id === state.memberId);
        if (member) {
          member.calendarId = calendarEmail;
          await store.saveMember(member);
        }
      }
    } catch (err) {
      console.error('Failed to update member calendarId:', err);
    }
  }

  // Show success page
  return new NextResponse(htmlPage(
    '✅ Google Calendar подключён!',
    `Календарь <b>${calendarEmail}</b> подключён к вашему профилю.<br>
    Теперь агент будет проверять вашу занятость перед назначением задач.<br><br>
    Calendar <b>${calendarEmail}</b> connected to your profile.<br>
    The agent will now check your availability before assigning tasks.<br><br>
    <i>Можете закрыть эту страницу / You can close this page.</i>`
  ), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Domovoy — Calendar</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1C1917;color:#FAFAF7}
.card{background:#292524;border-radius:16px;padding:40px;max-width:480px;text-align:center}
h2{color:#D97706;margin-bottom:16px}p{line-height:1.6;color:#A8A29E}b{color:#FAFAF7}</style>
</head>
<body><div class="card"><h2>${title}</h2><p>${body}</p></div></body>
</html>`;
}
