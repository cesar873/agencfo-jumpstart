// Vercel Edge Middleware — gates the whole site behind HTTP Basic Auth.
// Runs on every request before any function or static file is served, so
// both the dashboard HTML and the /api/sheets endpoint are protected.

const EXPECTED_PASSWORD = 'Jump$tartCFO2026&!';

export const config = {
  // Match everything except Vercel's internal paths and the favicon.
  matcher: '/((?!_vercel|favicon\\.ico).*)',
};

export default function middleware(request) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      // username:password — accept any username, only the password matters
      const colon = decoded.indexOf(':');
      const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
      if (pass === EXPECTED_PASSWORD) return; // pass through
    } catch { /* malformed base64 → fall through to 401 */ }
  }
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="AgenCFO Dashboard"',
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    },
  });
}
