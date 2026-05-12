import crypto from 'crypto';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets.readonly';

// Cache the token for the lifetime of a warm function instance
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY must be set in Vercel env vars.');

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
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email   = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key     = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  const { range, meta, diag } = req.query;

  // Diagnostic: GET /api/sheets?diag=1 — reports which env vars are visible
  // without leaking their values.
  if (diag) {
    // List the *names* (never values) of any env var that looks related, so
    // typos in Vercel's env var UI surface immediately.
    const candidateKeys = Object.keys(process.env)
      .filter(k => /GOOGLE|SHEET|SERVICE|ACCOUNT|EMAIL|GCP|SHEETS/i.test(k))
      .sort();

    return res.status(200).json({
      env: {
        GOOGLE_SHEET_ID:               !!sheetId,
        GOOGLE_SHEET_ID_length:        sheetId ? sheetId.length : 0,
        GOOGLE_SERVICE_ACCOUNT_EMAIL:  !!email,
        GOOGLE_SERVICE_ACCOUNT_EMAIL_endsWithIam: email ? email.endsWith('.iam.gserviceaccount.com') : false,
        GOOGLE_SERVICE_ACCOUNT_KEY:    !!key,
        GOOGLE_SERVICE_ACCOUNT_KEY_length: key ? key.length : 0,
        GOOGLE_SERVICE_ACCOUNT_KEY_looksPem: key ? key.includes('BEGIN PRIVATE KEY') : false,
      },
      registeredNames: candidateKeys,   // names only — safe to read
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
