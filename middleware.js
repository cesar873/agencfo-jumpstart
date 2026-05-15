// Vercel Edge Middleware — gates the whole site behind a styled login page.
// Sets a long-lived cookie on successful auth so the user only signs in once.
// Both the dashboard HTML and the /api/sheets endpoint are protected.

const PASSWORD     = 'Jump$tartCFO2026&!';
const COOKIE_NAME  = 'agencfo_auth';
const COOKIE_VALUE = 'ok'; // presence == authenticated; password is the secret
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

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

  // Cookie check
  const cookieHeader = request.headers.get('cookie') || '';
  const ok = cookieHeader.split(';').some(c => c.trim() === `${COOKIE_NAME}=${COOKIE_VALUE}`);
  if (ok) return; // pass through to the static file / function

  // Not authenticated — render the login page in place of the dashboard.
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
      display:flex;align-items:center;gap:8px;
      font-family:'Anton',sans-serif;font-size:22px;letter-spacing:.04em;
      margin-bottom:24px;
    }
    .brand .b1{color:#fff;}
    .brand .b2{color:var(--blue);}
    .brand .x{color:var(--muted);font-family:'Inter',sans-serif;font-weight:400;margin:0 6px;}
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
