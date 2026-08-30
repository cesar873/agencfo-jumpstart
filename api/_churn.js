// Server-side churn parsing + aggregation, ported from the client
// (parseChurnAnalysis / _renderPerfList in index.html) so the member-view
// numbers match the dashboard's default "Churned only" scope exactly.
// Leading underscore → not exposed as a Vercel route.

const DAY = 1000 * 60 * 60 * 24;

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

function parseDateLoose(s) {
  if (!s && s !== 0) return null;
  const str = String(s).trim();
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str) && +str > 30000 && +str < 60000) {
    const d = new Date((+str - 25569) * 86400000);
    return isNaN(d) ? null : d;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) { const d = new Date(str); return isNaN(d) ? null : d; }
  const m = str.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900; const d = new Date(y, +m[1] - 1, +m[2]); return isNaN(d) ? null : d; }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

export const CHURN_REASONS = ['Internal / Pause', 'Low ROAS / Lead Quality', 'Service / Comms', 'Poor Funnel', 'Bad Fit', 'Not Categorized'];

export function canonChurnReason(s) {
  if (!s) return 'Not Categorized';
  const t = String(s).toLowerCase();
  if (/internal|pause/.test(t))                                    return 'Internal / Pause';
  if (/low\s*roas|lead\s*quality/.test(t))                         return 'Low ROAS / Lead Quality';
  if (/unhappy|service|comms?|communication|creative/.test(t))     return 'Service / Comms';
  if (/poor\s*funnel|sales\s*process|funnel\s*conversion/.test(t)) return 'Poor Funnel';
  if (/bad\s*fit/.test(t))                                         return 'Bad Fit';
  return 'Not Categorized';
}

function shortenService(s) {
  if (!s) return '—';
  const x = String(s).trim();
  if (/^meta/i.test(x))     return 'Meta';
  if (/^google/i.test(x))   return 'Google';
  if (/^linkedin/i.test(x)) return 'LinkedIn';
  if (/^bing/i.test(x))     return 'Bing';
  if (/^tiktok/i.test(x))   return 'TikTok';
  if (/^snap/i.test(x))     return 'Snap';
  if (/^seo/i.test(x))      return 'SEO';
  if (/^email/i.test(x))    return 'Email';
  if (/^web/i.test(x))      return 'Web Design';
  return x.replace(/\s*Ads\s*Management$/i, '');
}

/** Parse the raw Churn Analysis value grid → array of churn records. */
export function parseChurnRows(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(h => String(h || '').trim());
  const findCol = (rx) => header.findIndex(h => rx.test(h));
  const iClient = findCol(/^client$/i);
  const iService = findCol(/^service`?$/i);
  const iStart = findCol(/start\s*date/i);
  const iEnd = findCol(/end\s*date/i);
  const iLife = findCol(/lifetime/i);
  const iTeam = findCol(/team\s*member/i);
  const iAM = findCol(/^am$/i);
  const iSource = findCol(/^source$/i);
  const iRet = findCol(/retainer/i);
  const iReason = findCol(/churn\s*reason/i);
  if (iClient < 0 || iEnd < 0) return [];

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const client = String(row[iClient] || '').trim();
    if (!client) continue;
    const endDate = parseDateLoose(row[iEnd]);
    const startDate = iStart >= 0 ? parseDateLoose(row[iStart]) : null;
    const lifetimeRaw = iLife >= 0 ? num(row[iLife]) : 0;
    const lifetime = (lifetimeRaw > 0 || (startDate && endDate))
      ? (lifetimeRaw > 0 ? lifetimeRaw : Math.max(0, Math.round(((endDate - startDate) / DAY) / 30)))
      : 0;
    const reasonRaw = iReason >= 0 ? String(row[iReason] || '') : '';
    out.push({
      client,
      service: iService >= 0 ? String(row[iService] || '').trim() : '',
      svcShort: iService >= 0 ? shortenService(row[iService]) : '—',
      endDate: endDate ? endDate.toISOString().slice(0, 10) : null,
      lifetime,
      teamMember: iTeam >= 0 ? String(row[iTeam] || '').trim() : '',
      am: iAM >= 0 ? String(row[iAM] || '').trim() : '',
      source: iSource >= 0 ? String(row[iSource] || '').trim() : '',
      retainer: iRet >= 0 ? num(row[iRet]) : 0,
      reason: canonChurnReason(reasonRaw),
    });
  }
  return out;
}

/** Parse the Services tab → engagement records (only the fields we need for
    active-contract attribution). Mirrors parseServicesTab in index.html. */
export function parseServicesRows(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(h => String(h || '').trim());
  const findCol = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iClient = findCol('Client');
  const iService = findCol('Service');
  if (iClient < 0 || iService < 0) return [];
  const iStatus = findCol('Status');
  const iEnd = findCol('End Date');
  const iTeam = findCol('Team Member');
  const iAM = findCol('Account Manager');
  const iRet = findCol('Retainer Value');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const client = String(row[iClient] || '').trim();
    const service = String(row[iService] || '').trim();
    if (!client || !service) continue;
    out.push({
      client, service,
      status: iStatus >= 0 ? String(row[iStatus] || '').trim() : '',
      endDate: iEnd >= 0 ? parseDateLoose(row[iEnd]) : null,
      teamMember: iTeam >= 0 ? String(row[iTeam] || '').trim() : '',
      am: iAM >= 0 ? String(row[iAM] || '').trim() : '',
      retainer: iRet >= 0 ? num(row[iRet]) : 0,
    });
  }
  return out;
}

/** Active (non-churned) engagements = status ~"active" and no end date.
    These form the denominator for the actual churn rate. */
export function activeFromServices(serviceRecords) {
  return (serviceRecords || [])
    .filter(r => /active/i.test(r.status || '') && !r.endDate)
    .map(r => ({ client: r.client, service: r.service, am: r.am, teamMember: r.teamMember, retainer: r.retainer, isActive: true }));
}

/** Distinct AM and MB names across churned AND active engagements, so everyone
    with any contract gets a link / appears on the leaderboard. */
export function rosterFromRecords(churned, actives = []) {
  const ams = new Set(), mbs = new Set();
  const add = (r) => { if (r.am) ams.add(r.am); if (r.teamMember) mbs.add(r.teamMember); };
  churned.forEach(add); actives.forEach(add);
  const sort = (s) => Array.from(s).sort((a, b) => a.localeCompare(b));
  return { ams: sort(ams), mbs: sort(mbs) };
}

const roleKey = (role) => (role === 'AM' ? 'am' : 'teamMember');

/** Ranked leaderboard for a role. Includes anyone with a churned OR active
    engagement. Primary metric = ACTUAL churn rate = churned / (churned+active),
    ranked worst-first; early-churn rate (early≤3mo / churned) kept as secondary. */
export function buildLeaderboard(churned, actives, role) {
  const key = roleKey(role);
  const map = new Map();
  const ensure = (name) => {
    if (!map.has(name)) map.set(name, { name, churned: 0, active: 0, early: 0, lifeSum: 0 });
    return map.get(name);
  };
  churned.forEach(r => {
    const name = r[key]; if (!name) return;
    const m = ensure(name); m.churned += 1; m.lifeSum += r.lifetime; if (r.lifetime <= 3) m.early += 1;
  });
  (actives || []).forEach(r => {
    const name = r[key]; if (!name) return;
    ensure(name).active += 1;
  });
  return Array.from(map.values())
    .map(m => {
      const total = m.churned + m.active;
      return {
        name: m.name,
        n: total,                                        // total book (churned + active)
        churned: m.churned,
        active: m.active,
        churnRate: total ? m.churned / total * 100 : 0,  // actual churn rate
        earlyRate: m.churned ? m.early / m.churned * 100 : 0,
        life: m.churned ? m.lifeSum / m.churned : 0,
      };
    })
    .sort((a, b) => b.churnRate - a.churnRate || b.churned - a.churned)
    .map((d, i) => ({ ...d, rank: i + 1 }));
}

/** Full scoped payload for one member: their own KPIs (incl. actual churn rate),
    reason breakdown, contract list, and their within-role leaderboard. */
export function buildMemberPayload(churned, actives, me) {
  const key = roleKey(me.role);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const mine = churned.filter(r => norm(r[key]) === norm(me.name));
  const mineActive = (actives || []).filter(r => norm(r[key]) === norm(me.name));

  const churnedN = mine.length;
  const activeN = mineActive.length;
  const total = churnedN + activeN;
  const early = mine.filter(r => r.lifetime <= 3).length;
  const immediate = mine.filter(r => r.lifetime === 0).length;
  const lifetimes = mine.map(r => r.lifetime).sort((a, b) => a - b);
  const avgLife = churnedN ? lifetimes.reduce((a, b) => a + b, 0) / churnedN : 0;
  const medianLife = churnedN ? lifetimes[Math.floor(churnedN / 2)] : 0;
  const lostRev = mine.reduce((a, r) => a + (r.retainer || 0), 0);

  const reasons = CHURN_REASONS.filter(x => x !== 'Not Categorized').map(reason => {
    const rs = mine.filter(r => r.reason === reason);
    return {
      reason,
      count: rs.length,
      pct: churnedN ? rs.length / churnedN * 100 : 0,
      avgLife: rs.length ? rs.reduce((a, r) => a + r.lifetime, 0) / rs.length : 0,
    };
  }).filter(x => x.count > 0);

  const contracts = mine
    .slice()
    .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))
    .map(r => ({ client: r.client, service: r.svcShort, lifetime: r.lifetime, reason: r.reason, endDate: r.endDate, retainer: r.retainer }));

  const board = buildLeaderboard(churned, actives, me.role).map(d => ({ ...d, isMe: norm(d.name) === norm(me.name) }));
  const myRow = board.find(d => d.isMe) || null;

  return {
    me: {
      name: me.name,
      role: me.role,
      kpis: {
        contracts: churnedN,             // churned engagements
        active: activeN,                 // still-active engagements
        total,                           // total book
        churnRate: total ? churnedN / total * 100 : 0,   // ACTUAL churn rate
        earlyCount: early,
        earlyRate: churnedN ? early / churnedN * 100 : 0,
        immediateCount: immediate,
        immediateRate: churnedN ? immediate / churnedN * 100 : 0,
        avgLife,
        medianLife,
        lostRev,
        rank: myRow ? myRow.rank : null,
        fieldSize: board.length,
      },
      reasons,
      contracts,
    },
    leaderboard: { role: me.role, rows: board },
    meta: { totalInRole: board.length, churnedRecords: churned.length, activeRecords: (actives || []).length },
  };
}
