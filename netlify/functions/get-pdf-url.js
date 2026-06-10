// SEN'SIN – Leitfaden PDF SignedUrl Generator
// Nutzt Service-Role-Key → umgeht RLS-Probleme komplett
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Token aus Authorization-Header
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Nicht eingeloggt' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const file = body.file;
    if (!file) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dateiname fehlt' }) };
    }

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // User aus Token verifizieren
    const userResult = await sb.auth.getUser(token);
    if (userResult.error || !userResult.data || !userResult.data.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ungueltige Session' }) };
    }
    const user = userResult.data.user;

    // hat_leitfaeden pruefen
    const rowResult = await sb.from('users').select('hat_leitfaeden').eq('id', user.id).single();
    if (!rowResult.data || rowResult.data.hat_leitfaeden !== true) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Kein Leitfaeden-Zugang' }) };
    }

    // SignedUrl erstellen (Service-Role umgeht RLS)
    const urlResult = await sb.storage.from('leitfaeden').createSignedUrl(file, 3600);
    if (urlResult.error || !urlResult.data || !urlResult.data.signedUrl) {
      const msg = urlResult.error ? urlResult.error.message : 'URL konnte nicht erstellt werden';
      return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ signedUrl: urlResult.data.signedUrl }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
