import crypto from 'crypto';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
// Read/write — the Bookkeeping clarification queue writes back to columns
// O (Category) and P (Comments). Requires the service account to have
// Editor access on the sheet.
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';

// Cache the token for the lifetime of a warm function instance
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Best-effort normalisation of whatever the user pasted into Vercel for the
 * service-account private key. Handles:
 *   - the full credentials JSON file pasted as the env value
 *   - surrounding single/double quotes
 *   - literal `\n` (one or two backslashes) instead of real newlines
 *   - CRLF line endings
 *   - leading/trailing whitespace
 *
 * Returns a string. Caller should still validate it `includes('BEGIN PRIVATE KEY')`.
 */
function normalizeKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  // Strip wrapping quotes (`"..."` or `'...'`)
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // If the user pasted the full service-account credentials JSON, pull out `.private_key`.
  if (k.startsWith('{')) {
    try {
      const parsed = JSON.parse(k);
      if (parsed && typeof parsed.private_key === 'string') k = parsed.private_key;
    } catch { /* not JSON; fall through */ }
  }
  // Decode escaped newlines (handle `\\n` first so we don't re-escape).
  k = k.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
  // Normalise line endings.
  k = k.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return k.trim();
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL;
  const key   = normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_KEY);

  if (!email || !key) throw new Error('Service account email or key not set in Vercel env vars (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY).');
  if (!key.includes('BEGIN PRIVATE KEY')) throw new Error('Private key is missing PEM header — make sure you pasted only the private_key value (or the full credentials JSON), not just the base64 body.');

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: email, scope: SCOPE,
    aud: TOKEN_URL,
    iat: now, exp: now + 3600,
  })).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(key, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error);

  cachedToken = tokenData.access_token;
  tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sheetId = process.env.GOOGLE_SHEET_ID  || process.env.GOOGLE_SHEETS_ID;
  const email   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL;
  const rawKey  = process.env.GOOGLE_SERVICE_ACCOUNT_KEY   || process.env.GOOGLE_SERVICE_KEY;
  const key     = normalizeKey(rawKey);

  // ── WRITE: POST { range:"Bookkeeping!O5", value:"..." } → updates one cell.
  //    Used by the Payments / Transactions-clarification queue. Requires the
  //    service account to be an Editor on the sheet.
  if (req.method === 'POST') {
    if (!sheetId) return res.status(500).json({ error: 'GOOGLE_SHEET_ID not set in Vercel env vars.' });
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const wRange = body && body.range;
      const wValue = body && body.value != null ? String(body.value) : '';
      if (!wRange || !/^[^!]+![A-Z]+\d+$/.test(wRange)) {
        return res.status(400).json({ error: 'POST body needs { range:"Tab!A1", value:"..." } — single cell only.' });
      }
      const token = await getAccessToken();
      const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(wRange)}?valueInputOption=USER_ENTERED`;
      const upstream = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[wValue]] }),
      });
      const data = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: (data.error && data.error.message) || 'Write failed' });
      return res.status(200).json({ ok: true, updated: data.updatedRange || wRange });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const { range, meta, diag, peek } = req.query;

  // Convenience: /api/sheets?peek=TabName — returns the first 30 rows of a
  // tab so we can quickly inspect the shape before writing a parser.
  if (peek) {
    if (!sheetId) return res.status(500).json({ error: 'GOOGLE_SHEET_ID not set in Vercel env vars.' });
    try {
      const token = await getAccessToken();
      const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(peek + '!A1:Z30')}`;
      const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Diagnostic: GET /api/sheets?diag=1 — reports which env vars are visible
  // without leaking their values.
  if (diag) {
    const candidateKeys = Object.keys(process.env)
      .filter(k => /GOOGLE|SHEET|SERVICE|ACCOUNT|EMAIL|GCP|SHEETS/i.test(k))
      .sort();

    return res.status(200).json({
      env: {
        GOOGLE_SHEET_ID:               !!sheetId,
        GOOGLE_SHEET_ID_length:        sheetId ? sheetId.length : 0,
        GOOGLE_SERVICE_ACCOUNT_EMAIL:  !!email,
        GOOGLE_SERVICE_ACCOUNT_EMAIL_endsWithIam: email ? email.endsWith('.iam.gserviceaccount.com') : false,
        GOOGLE_SERVICE_ACCOUNT_KEY:    !!rawKey,
        GOOGLE_SERVICE_ACCOUNT_KEY_raw_length:  rawKey ? rawKey.length : 0,
        GOOGLE_SERVICE_ACCOUNT_KEY_raw_startsWithBrace: rawKey ? rawKey.trim().startsWith('{') : false,
        GOOGLE_SERVICE_ACCOUNT_KEY_normalized_length:   key.length,
        GOOGLE_SERVICE_ACCOUNT_KEY_hasBeginMarker:      key.includes('BEGIN PRIVATE KEY'),
        GOOGLE_SERVICE_ACCOUNT_KEY_hasEndMarker:        key.includes('END PRIVATE KEY'),
        GOOGLE_SERVICE_ACCOUNT_KEY_realNewlineCount:    (key.match(/\n/g) || []).length,
      },
      registeredNames: candidateKeys,
      vercel: {
        env:    process.env.VERCEL_ENV    || null,
        region: process.env.VERCEL_REGION || null,
        url:    process.env.VERCEL_URL    || null,
      },
      ts: new Date().toISOString(),
    });
  }

  if (!sheetId) return res.status(500).json({ error: 'GOOGLE_SHEET_ID not set in Vercel env vars.' });

  try {
    const token = await getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    let url;
    if (meta) {
      url = `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`;
    } else if (range) {
      url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`;
    } else {
      return res.status(400).json({ error: 'Provide ?range=Sheet!A1:Z100 or ?meta=1' });
    }

    const upstream = await fetch(url, { headers });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
