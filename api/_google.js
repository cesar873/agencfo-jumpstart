// Shared Google Sheets READ helper for the member endpoints.
// Node runtime only (uses the Node `crypto` module for the RS256 JWT). The
// leading underscore keeps Vercel from exposing this file as an API route.
// Mirrors the auth/normalisation logic in api/sheets.js, but read-only.

import crypto from 'crypto';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export function normalizeKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  if (k.startsWith('{')) {
    try { const p = JSON.parse(k); if (p && typeof p.private_key === 'string') k = p.private_key; } catch { /* not JSON */ }
  }
  k = k.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
  k = k.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return k.trim();
}

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL;
  const key   = normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_KEY);
  if (!email || !key) throw new Error('Service account email or key not set (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY).');
  if (!key.includes('BEGIN PRIVATE KEY')) throw new Error('Private key missing PEM header.');

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })).toString('base64url');
  const signer  = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'token request failed');
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID not set in Vercel env vars.');
  return id;
}

/** Return the value grid (array of rows) for a range, e.g. "Churn Analysis!A1:Z2000". */
export async function sheetsValues(range) {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${sheetId()}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'sheet read failed');
  return data.values || [];
}

/** Return the list of tab (sheet) titles in the spreadsheet. */
export async function listTabs() {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${sheetId()}?fields=sheets.properties`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'meta read failed');
  return (data.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
}
