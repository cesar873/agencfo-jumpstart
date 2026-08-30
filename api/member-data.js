// Scoped, locked-down data endpoint for a single team member.
// Verifies the signed link token, then returns ONLY that person's own churn
// rows + reason breakdown + their within-role leaderboard AGGREGATES. No other
// person's raw contracts ever leave the server.
//
// Access is gated twice: middleware.js requires (a) a valid token in ?m and
// (b) the shared member-password cookie before this function is even reached.
// This handler re-verifies the token as defense-in-depth.

import { verifyToken } from '../_token.js';
import { sheetsValues, listTabs } from './_google.js';
import { parseChurnRows, parseServicesRows, activeFromServices, buildMemberPayload } from './_churn.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.MEMBER_LINK_SECRET;
  if (!secret) return res.status(500).json({ error: 'MEMBER_LINK_SECRET not set in Vercel env vars.' });

  const token = (req.query && req.query.m) || '';
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.n) return res.status(401).json({ error: 'Invalid or expired link.' });

  const me = { name: String(payload.n), role: payload.r === 'AM' ? 'AM' : 'MB' };

  try {
    const tabs = await listTabs();
    const churnTab = tabs.find(t => /^\s*churn\s*analysis\s*$/i.test(t)) || tabs.find(t => /churn/i.test(t));
    if (!churnTab) return res.status(500).json({ error: 'Churn Analysis tab not found in the spreadsheet.' });
    const svcTab = tabs.find(t => /^\s*services?\s*$/i.test(t));

    const churned = parseChurnRows(await sheetsValues(`${churnTab}!A1:Z2000`));
    // Active engagements (denominator for the actual churn rate) come from the
    // Services tab. If it's absent, churn rate falls back to 100% of churned.
    let actives = [];
    if (svcTab) {
      try { actives = activeFromServices(parseServicesRows(await sheetsValues(`${svcTab}!A1:BZ2000`))); }
      catch { actives = []; }
    }

    const result = buildMemberPayload(churned, actives, me);
    result.meta.churnTab = churnTab;
    result.meta.servicesTab = svcTab || null;
    result.meta.generatedAt = new Date().toISOString();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
