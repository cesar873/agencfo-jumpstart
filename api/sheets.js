const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey  = process.env.GOOGLE_SHEETS_API_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!apiKey || !sheetId) {
    return res.status(500).json({ error: 'GOOGLE_SHEETS_API_KEY and GOOGLE_SHEET_ID must be set in Vercel environment variables.' });
  }

  const { range, meta } = req.query;

  let url;
  if (meta) {
    url = `${SHEETS_BASE}/${sheetId}?fields=sheets.properties&key=${apiKey}`;
  } else if (range) {
    url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  } else {
    return res.status(400).json({ error: 'Provide ?range=Sheet!A1:Z100 or ?meta=1' });
  }

  const upstream = await fetch(url);
  const data = await upstream.json();
  return res.status(upstream.status).json(data);
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // ... rest of your code ...
}
