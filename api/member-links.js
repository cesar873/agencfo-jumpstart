// Admin-only page that lists a personal member link for every AM and MB.
// NOT a member path, so middleware.js requires the MASTER password cookie to
// reach it — only whoever holds the dashboard password can mint/see links.
// Renders an HTML page with copy buttons.

import { signToken } from '../_token.js';
import { sheetsValues, listTabs } from './_google.js';
import { parseChurnRows, parseServicesRows, activeFromServices, rosterFromRecords } from './_churn.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.MEMBER_LINK_SECRET;

  const origin = () => {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return `${proto}://${host}`;
  };

  const page = (bodyHtml) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Member links · AgenCFO</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:'Inter',system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 20% 0%,#11314c 0%,#0a1929 55%,#050e1a 100%);color:#e5edf6;min-height:100vh;padding:40px 20px}
  .wrap{max-width:840px;margin:0 auto}
  .topbar{display:flex;align-items:center;gap:12px;margin-bottom:22px}
  .btn-ghost{display:inline-flex;align-items:center;gap:6px;text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);color:#cdd8e6;border-radius:8px;font-size:12px;font-weight:600;padding:8px 12px;transition:background .12s}
  .btn-ghost:hover{background:rgba(255,255,255,.09)}
  .admin-tag{font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:rgba(255,255,255,.55);font-size:13px;margin-bottom:28px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5);margin:28px 0 10px}
  .row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;margin-bottom:8px}
  .nm{width:200px;font-weight:600;font-size:14px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lk{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:rgba(255,255,255,.6);background:rgba(0,0,0,.25);border:0;border-radius:6px;padding:8px 10px;width:100%;overflow:hidden;text-overflow:ellipsis}
  button{flex:none;background:#1390eb;border:0;border-radius:8px;color:#fff;font:inherit;font-size:12px;font-weight:600;padding:8px 14px;cursor:pointer}
  button:hover{background:#1a9deb}
  button.copied{background:#22c55e}
  .empty{color:rgba(255,255,255,.4);font-size:13px;padding:12px 0}
  .warn{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);color:#fca5a5;border-radius:8px;padding:12px 14px;font-size:13px;margin-bottom:20px}
</style></head><body><div class="wrap"><div class="topbar"><a class="btn-ghost" href="/">&larr; Main dashboard</a><span class="admin-tag">Admin · member links directory</span></div>${bodyHtml}</div>
<script>
  document.addEventListener('click', function(e){
    var b = e.target.closest('button[data-link]'); if(!b) return;
    navigator.clipboard.writeText(b.getAttribute('data-link')).then(function(){
      var old=b.textContent; b.textContent='Copied'; b.classList.add('copied');
      setTimeout(function(){ b.textContent=old; b.classList.remove('copied'); }, 1400);
    });
  });
</script></body></html>`;

  if (!secret) {
    return res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(page(`<h1>Member links</h1><div class="warn"><strong>MEMBER_LINK_SECRET is not set.</strong> Add a long random string as <code>MEMBER_LINK_SECRET</code> (and a <code>MEMBER_PASSWORD</code>) in the Vercel project env vars, then redeploy.</div>`));
  }

  try {
    const tabs = await listTabs();
    const churnTab = tabs.find(t => /^\s*churn\s*analysis\s*$/i.test(t)) || tabs.find(t => /churn/i.test(t));
    if (!churnTab) throw new Error('Churn Analysis tab not found.');
    const svcTab = tabs.find(t => /^\s*services?\s*$/i.test(t));
    const churned = parseChurnRows(await sheetsValues(`${churnTab}!A1:Z2000`));
    let actives = [];
    if (svcTab) {
      try { actives = activeFromServices(parseServicesRows(await sheetsValues(`${svcTab}!A1:BZ2000`))); }
      catch { actives = []; }
    }
    const { ams, mbs } = rosterFromRecords(churned, actives);
    const base = origin();

    const section = async (title, names, role) => {
      if (!names.length) return `<h2>${esc(title)}</h2><div class="empty">None found in the churn data.</div>`;
      const rows = await Promise.all(names.map(async (name) => {
        const token = await signToken({ n: name, r: role }, secret);
        const link = `${base}/member.html?m=${encodeURIComponent(token)}`;
        return `<div class="row"><div class="nm" title="${esc(name)}">${esc(name)}</div><input class="lk" readonly value="${esc(link)}"><button data-link="${esc(link)}">Copy</button></div>`;
      }));
      return `<h2>${esc(title)} · ${names.length}</h2>${rows.join('')}`;
    };

    const body = `<h1>Member links</h1>
      <div class="sub">One private link per person. Each opens their own scoped view after the member password. Links do not expire; rotating <code>MEMBER_LINK_SECRET</code> invalidates all of them.</div>
      ${await section('Account Managers', ams, 'AM')}
      ${await section('Team Members (MB)', mbs, 'MB')}`;

    return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(page(body));
  } catch (err) {
    return res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(page(`<h1>Member links</h1><div class="warn">${esc(err.message)}</div>`));
  }
}
