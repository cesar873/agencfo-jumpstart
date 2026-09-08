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

// Local (non-UTC) YYYY-MM-DD so month boundaries don't shift by a timezone offset.
function localISO(d) {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
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
      startDate: localISO(startDate),
      endDate: localISO(endDate),
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
  const iStart = findCol('Start Date');
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
      startDate: iStart >= 0 ? parseDateLoose(row[iStart]) : null,
      endDate: iEnd >= 0 ? parseDateLoose(row[iEnd]) : null,
      teamMember: iTeam >= 0 ? String(row[iTeam] || '').trim() : '',
      am: iAM >= 0 ? String(row[iAM] || '').trim() : '',
      retainer: iRet >= 0 ? num(row[iRet]) : 0,
    });
  }
  return out;
}

/** Active (non-churned) engagements = status ~"active" and no end date.
    These contribute to the monthly "active that month" denominator. */
export function activeFromServices(serviceRecords) {
  return (serviceRecords || [])
    .filter(r => /active/i.test(r.status || '') && !r.endDate)
    .map(r => ({ client: r.client, service: r.service, am: r.am, teamMember: r.teamMember, retainer: r.retainer, startDate: localISO(r.startDate), isActive: true }));
}

/** Split a possibly comma-separated names cell into individual trimmed names
    (Services "Team Member" can list several media buyers on one client). */
function splitNames(s) {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Month index = year*12 + (month-1). Reversible, easy to compare/iterate.
function isoToIdx(iso) {
  const m = iso && String(iso).match(/^(\d{4})-(\d{2})/);
  return m ? (+m[1]) * 12 + (+m[2] - 1) : null;
}
function dateToIdx(v) {
  const d = parseDateLoose(v);
  return d ? d.getFullYear() * 12 + d.getMonth() : null;
}
function idxToLabel(idx) {
  return `${MON[((idx % 12) + 12) % 12]} '${String(Math.floor(idx / 12)).slice(2)}`;
}

/** Parse the People tab — the authoritative roster + tenure source.
    Category "Account Managers" -> AM, "Media Buyers" -> MB (every other
    category, incl. "Owner, Account Managers", is excluded). A Status of
    left/inactive/former/terminated marks someone as no longer active. */
export function parsePeopleRows(rows) {
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map(h => String(h || '').trim());
  const col = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iN = col('Name'), iStat = col('Status'), iCat = col('Category'), iS = col('Start Date'), iE = col('End Date');
  if (iN < 0 || iCat < 0) return [];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[iN] || '').trim();
    if (!name) continue;
    const cat = String(row[iCat] || '').trim();
    let role = null;
    if (/^account managers$/i.test(cat)) role = 'AM';
    else if (/^media buyers$/i.test(cat)) role = 'MB';
    const status = iStat >= 0 ? String(row[iStat] || '').trim() : '';
    out.push({
      name, role, status,
      active: !/left|inactive|former|terminated/i.test(status),
      hireIdx: iS >= 0 ? dateToIdx(row[iS]) : null,
      endIdx: iE >= 0 ? dateToIdx(row[iE]) : null,
    });
  }
  return out;
}

/** Active AM / MB roster (names) from the People tab. */
export function rosterFromPeople(people) {
  const pick = (role) => (people || [])
    .filter(p => p.role === role && p.active)
    .map(p => p.name)
    .sort((a, b) => a.localeCompare(b));
  return { ams: pick('AM'), mbs: pick('MB') };
}

const roleField = (role) => (role === 'AM' ? 'am' : 'teamMember');

/** Monthly churn payload for one member.
 *
 * MONTHLY (periodic) churn — not cumulative — so long tenure doesn't inflate it:
 *   for month k:  base(k)    = engagements ACTIVE during month k
 *                              (started on/before k, not yet ended before k)
 *                 churned(k) = engagements that ENDED in month k
 *                 rate(k)    = churned(k) / base(k)
 *
 * Returns each person's base[]/churned[] arrays aligned to a shared `months`
 * axis so the client can filter to any period and rank the within-role
 * leaderboard for that window. Only the viewer's OWN raw churned rows are sent
 * (for the reason/contract detail); peers are aggregate counts only.
 */
export function buildMemberPayload(churned, actives, people, me) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const field = roleField(me.role);

  // Expand contracts to (who, start-idx, end-idx) for the viewer's role field.
  // A Team Member cell can list several MBs (comma-separated) -> one entry each.
  const expand = [];
  const push = (whoRaw, sIdx, eIdx) => {
    const names = me.role === 'MB' ? splitNames(whoRaw) : (whoRaw ? [String(whoRaw).trim()] : []);
    names.forEach(nm => { if (nm) expand.push({ who: nm, key: norm(nm), sIdx, eIdx }); });
  };
  churned.forEach(r => push(r[field], isoToIdx(r.startDate), isoToIdx(r.endDate)));
  (actives || []).forEach(r => push(r[field], isoToIdx(r.startDate), null));

  // Tenure start per person: People hire date first, else earliest client start.
  const hireOf = new Map();
  (people || []).forEach(p => { if (p.hireIdx != null) hireOf.set(norm(p.name), p.hireIdx); });
  const earliest = new Map();
  expand.forEach(c => {
    if (c.sIdx == null) return;
    if (!earliest.has(c.key) || c.sIdx < earliest.get(c.key)) earliest.set(c.key, c.sIdx);
  });
  const startOf = (nm) => {
    const k = norm(nm);
    return hireOf.has(k) ? hireOf.get(k) : (earliest.has(k) ? earliest.get(k) : null);
  };

  // Month axis: earliest tenure/contract start -> last COMPLETE month (the
  // current, still-accruing month is never shown or averaged).
  const now = new Date();
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const lastComplete = nowIdx - 1;
  const allStarts = [];
  expand.forEach(c => { if (c.sIdx != null) allStarts.push(c.sIdx); });
  hireOf.forEach(v => allStarts.push(v));
  let minIdx = allStarts.length ? Math.min(...allStarts) : lastComplete;
  if (minIdx > lastComplete) minIdx = lastComplete;
  const months = [];
  for (let k = minIdx; k <= lastComplete; k++) months.push({ idx: k, label: idxToLabel(k) });

  // Roster = Active people of this role (People tab); fallback to data-derived
  // names if the People tab is missing/empty.
  let rosterNames = (people || []).filter(p => p.role === me.role && p.active).map(p => p.name);
  if (!rosterNames.length) rosterNames = Array.from(new Set(expand.map(c => c.who)));

  const byPerson = new Map();
  expand.forEach(c => { if (!byPerson.has(c.key)) byPerson.set(c.key, []); byPerson.get(c.key).push(c); });

  // Each person's monthly base/churned, CLAMPED to their tenure start so
  // pre-hire (often mis-attributed) months never dilute their rate.
  const peopleOut = rosterNames.map(name => {
    const start = startOf(name);
    const cs = byPerson.get(norm(name)) || [];
    const base = months.map(() => 0), churnedArr = months.map(() => 0);
    cs.forEach(c => {
      if (c.sIdx == null) return;
      for (let i = 0; i < months.length; i++) {
        const k = months[i].idx;
        if (start != null && k < start) continue;
        if (c.sIdx <= k && (c.eIdx == null || c.eIdx >= k)) base[i]++;
        if (c.eIdx === k) churnedArr[i]++;
      }
    });
    return { name, isMe: norm(name) === norm(me.name), startIdx: start, base, churned: churnedArr };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const meStart = startOf(me.name);
  // Viewer's own churned engagements (raw) for the reason donut + detail table,
  // limited to their tenure (churns dated on/after their start).
  const mineChurned = churned
    .filter(r => me.role === 'MB' ? splitNames(r[field]).some(n => norm(n) === norm(me.name)) : norm(r[field]) === norm(me.name))
    .filter(r => { const e = isoToIdx(r.endDate); return e != null && (meStart == null || e >= meStart); })
    .map(r => ({ client: r.client, service: r.svcShort, startDate: r.startDate, endDate: r.endDate, lifetime: r.lifetime, reason: r.reason, retainer: r.retainer }))
    .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));

  return {
    me: { name: me.name, role: me.role, startIdx: meStart, churned: mineChurned },
    months,
    leaderboard: { role: me.role, people: peopleOut },
    meta: { totalInRole: peopleOut.length, churnedRecords: churned.length, activeRecords: (actives || []).length, rosterSource: (people && people.length) ? 'people' : 'data' },
  };
}
