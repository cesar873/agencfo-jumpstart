// Vercel Edge Middleware — gates the whole site behind a styled login page.
// Sets a long-lived cookie on successful auth so the user only signs in once.
// Both the dashboard HTML and the /api/sheets endpoint are protected.
//
// TWO tiers of access:
//  1. MASTER password  → cookie `agencfo_auth`   → full dashboard + all APIs.
//  2. MEMBER password  → cookie `agencfo_member`  → member.html + /api/member-data
//     ONLY, and only alongside a valid signed ?m token. It never unlocks the
//     dashboard or /api/sheets. The token scopes the view to one person.

import { verifyToken } from './_token.js';

const PASSWORD     = 'Jump$tartCFO2026&!';
const COOKIE_NAME  = 'agencfo_auth';
const COOKIE_VALUE = 'ok'; // presence == authenticated; password is the secret
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Member-view tier (separate password + per-person signed link token).
const MEMBER_PASSWORD     = process.env.MEMBER_PASSWORD || '';
const MEMBER_SECRET       = process.env.MEMBER_LINK_SECRET || '';
const MEMBER_COOKIE       = 'agencfo_member';
const MEMBER_COOKIE_VALUE = 'ok';

// The only paths a member (token + member password) may reach.
function isMemberPath(pathname) {
  return pathname === '/member.html' || pathname === '/api/member-data';
}

export const config = {
  matcher: '/((?!_vercel|favicon\\.ico).*)',
};

export default async function middleware(request) {
  const url = new URL(request.url);

  // Login form submission
  if (request.method === 'POST' && url.pathname === '/auth') {
    let password = '';
    try {
      const form = await request.formData();
      password = String(form.get('password') || '');
    } catch { /* ignore malformed bodies */ }
    if (password === PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': `${COOKIE_NAME}=${COOKIE_VALUE}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
        },
      });
    }
    return loginResponse({ error: 'Incorrect password. Try again.' });
  }

  // Member login form submission — separate password, member views only.
  if (request.method === 'POST' && url.pathname === '/member-auth') {
    let password = '';
    let token = url.searchParams.get('m') || '';
    try {
      const form = await request.formData();
      password = String(form.get('password') || '');
      if (!token) token = String(form.get('m') || '');
    } catch { /* ignore malformed bodies */ }
    if (MEMBER_PASSWORD && password === MEMBER_PASSWORD) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `/member.html?m=${encodeURIComponent(token)}`,
          'Set-Cookie': `${MEMBER_COOKIE}=${MEMBER_COOKIE_VALUE}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
        },
      });
    }
    return memberLoginResponse({ error: 'Incorrect password. Try again.', m: token });
  }

  // Master cookie → full access to everything.
  const cookieHeader = request.headers.get('cookie') || '';
  const hasMaster = cookieHeader.split(';').some(c => c.trim() === `${COOKIE_NAME}=${COOKIE_VALUE}`);
  if (hasMaster) return; // pass through to the static file / function

  // Member surface — member.html and its scoped data API. A valid signed token
  // grants entry to ONLY these paths, and only after the member password. It
  // never unlocks the dashboard or /api/sheets.
  if (isMemberPath(url.pathname)) {
    const token = url.searchParams.get('m') || '';
    const payload = MEMBER_SECRET ? await verifyToken(token, MEMBER_SECRET) : null;
    if (!payload) {
      return url.pathname.startsWith('/api/')
        ? jsonResponse(401, { error: 'Invalid or expired link.' })
        : invalidLinkResponse();
    }
    const hasMember = cookieHeader.split(';').some(c => c.trim() === `${MEMBER_COOKIE}=${MEMBER_COOKIE_VALUE}`);
    if (!hasMember) {
      return url.pathname.startsWith('/api/')
        ? jsonResponse(401, { error: 'Member password required.' })
        : memberLoginResponse({ m: token });
    }
    return; // token valid + member password present → allow through
  }

  // Anything else requires the master password.
  return loginResponse({});
}

function loginResponse({ error } = {}) {
  const errorHtml = error
    ? `<div class="err">${error}</div>`
    : `<div class="err" style="visibility:hidden">.</div>`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sign in · AgenCFO × Jumpstart ROI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    :root{
      --bg:#0a1929;
      --card:#0f2540;
      --card-border:rgba(255,255,255,.08);
      --text:#e5edf6;
      --muted:rgba(255,255,255,.55);
      --blue:#1390eb;
      --green:#22c55e;
      --red:#ef4444;
      --amber:#f59e0b;
    }
    html,body{height:100%;}
    body{
      margin:0;
      font-family:'Inter',system-ui,-apple-system,sans-serif;
      background:radial-gradient(circle at 20% 0%, #11314c 0%, var(--bg) 55%, #050e1a 100%);
      color:var(--text);
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;padding:24px;
    }
    .shell{
      width:100%;max-width:420px;
      background:linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,0) 100%),var(--card);
      border:1px solid var(--card-border);
      border-radius:18px;
      padding:36px 32px 32px;
      box-shadow:0 24px 60px -20px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.02) inset;
    }
    .brand{
      display:flex;align-items:center;gap:0;white-space:nowrap;
      font-family:'Anton',sans-serif;font-size:22px;letter-spacing:1px;line-height:1;
      margin-bottom:24px;
    }
    .brand .b1{color:#fff;}
    .brand .b2{color:var(--blue);}
    .brand .x{color:rgba(255,255,255,.4);font-family:'Inter',sans-serif;font-weight:400;margin:0 8px;}
    .brand .b3{color:#fff;}
    h1{
      font-family:'Anton',sans-serif;
      font-size:32px;font-weight:400;letter-spacing:.01em;
      margin:0 0 6px;
    }
    .sub{
      font-size:13px;color:var(--muted);margin-bottom:24px;
    }
    label{
      display:block;font-size:11px;font-weight:600;letter-spacing:.08em;
      text-transform:uppercase;color:var(--muted);
      margin-bottom:8px;
    }
    input[type=password]{
      width:100%;
      background:rgba(255,255,255,.04);
      border:1px solid var(--card-border);
      border-radius:10px;
      padding:12px 14px;
      color:var(--text);
      font-family:inherit;font-size:14px;
      outline:none;
      transition:border-color .15s,background .15s;
    }
    input[type=password]:focus{
      border-color:var(--blue);
      background:rgba(255,255,255,.06);
    }
    button{
      width:100%;margin-top:16px;
      background:var(--blue);
      border:0;border-radius:10px;
      padding:12px 14px;
      color:#fff;font-family:inherit;font-size:14px;font-weight:600;
      letter-spacing:.02em;
      cursor:pointer;
      transition:background .15s,transform .05s;
    }
    button:hover{background:#1a9deb;}
    button:active{transform:translateY(1px);}
    .err{
      margin-top:14px;font-size:12px;color:#fca5a5;
      background:rgba(239,68,68,.08);
      border:1px solid rgba(239,68,68,.25);
      border-radius:8px;padding:8px 12px;
      min-height:32px;
    }
    .foot{
      margin-top:28px;font-size:11px;color:var(--muted);text-align:center;letter-spacing:.04em;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="brand">
      <span class="b1">AGEN</span><span class="b2">CFO</span>
      <span class="x">×</span>
      <span class="b3">JUMPSTART ROI</span>
    </div>
    <h1>Sign in</h1>
    <p class="sub">Enter the dashboard password to continue.</p>
    <form method="POST" action="/auth" autocomplete="on">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required autocomplete="current-password" />
      <button type="submit">Unlock dashboard</button>
      ${errorHtml}
    </form>
    <div class="foot">Live from Jumpstart ROI · Vercel-hosted</div>
  </div>
</body>
</html>`;
  return new Response(html, {
    // 200 (not 401) so browsers don't cache it as a failure or pop their
    // native auth dialog.
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Shared page chrome for the member-tier screens (mirrors the master login look).
function memberShell(inner) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your view · AgenCFO × Jumpstart ROI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;}
    body{margin:0;font-family:'Inter',system-ui,-apple-system,sans-serif;
      background:radial-gradient(circle at 20% 0%, #11314c 0%, #0a1929 55%, #050e1a 100%);
      color:#e5edf6;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
    .shell{width:100%;max-width:420px;background:linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,0) 100%),#0f2540;
      border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:36px 32px 32px;
      box-shadow:0 24px 60px -20px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.02) inset;}
    .brand{display:flex;align-items:center;gap:0;white-space:nowrap;font-family:'Anton',sans-serif;font-size:22px;letter-spacing:1px;line-height:1;margin-bottom:24px;}
    .brand .b1{color:#fff;}.brand .b2{color:#1390eb;}.brand .x{color:rgba(255,255,255,.4);font-family:'Inter',sans-serif;font-weight:400;margin:0 8px;}.brand .b3{color:#fff;}
    h1{font-family:'Anton',sans-serif;font-size:32px;font-weight:400;margin:0 0 6px;}
    .sub{font-size:13px;color:rgba(255,255,255,.55);margin-bottom:24px;}
    label{display:block;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:8px;}
    input[type=password]{width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;color:#e5edf6;font-family:inherit;font-size:14px;outline:none;}
    input[type=password]:focus{border-color:#1390eb;background:rgba(255,255,255,.06);}
    button{width:100%;margin-top:16px;background:#1390eb;border:0;border-radius:10px;padding:12px 14px;color:#fff;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;}
    button:hover{background:#1a9deb;}
    .err{margin-top:14px;font-size:12px;color:#fca5a5;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:8px 12px;min-height:32px;}
    .foot{margin-top:28px;font-size:11px;color:rgba(255,255,255,.55);text-align:center;letter-spacing:.04em;}
  </style>
</head>
<body>
  <div class="shell">
    <div class="brand"><span class="b1">AGEN</span><span class="b2">CFO</span><span class="x">×</span><span class="b3">JUMPSTART ROI</span></div>
    ${inner}
  </div>
</body>
</html>`;
}

function memberLoginResponse({ error, m } = {}) {
  const errorHtml = error
    ? `<div class="err">${error}</div>`
    : `<div class="err" style="visibility:hidden">.</div>`;
  const action = `/member-auth?m=${encodeURIComponent(m || '')}`;
  const inner = `
    <h1>Your view</h1>
    <p class="sub">Enter the team access password to open your personal performance view.</p>
    <form method="POST" action="${action}" autocomplete="on">
      <label for="password">Access password</label>
      <input type="password" id="password" name="password" autofocus required autocomplete="current-password" />
      <input type="hidden" name="m" value="${(m || '').replace(/"/g, '&quot;')}" />
      <button type="submit">Open my view</button>
      ${errorHtml}
    </form>
    <div class="foot">Private link · scoped to you</div>`;
  return new Response(memberShell(inner), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function invalidLinkResponse() {
  const inner = `
    <h1>Link not valid</h1>
    <p class="sub">This link is missing or has expired. Ask your admin for a fresh personal link.</p>
    <div class="foot">Private link · scoped to you</div>`;
  return new Response(memberShell(inner), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
