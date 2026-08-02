// Cleans up an engineer's rushed, on-site job notes into a clear paragraph
// (with a bullet list when there's more than one distinct issue) using
// Gemini's free tier — same provider and same "always show the button,
// degrade gracefully if it's not configured" pattern as extract-cert-data.
// No OCR-style fallback here: there's nothing sensible to fall back to for
// text rewriting, so a missing/failing key just returns a clear error the
// UI surfaces as a toast, leaving the engineer's original text untouched.
//
// Auth: Office App staff carry a real Supabase Auth JWT. Employee App
// engineers may be in either auth mode (see apps/engineer/main.js's
// _isTokenAuth) — password-mode engineers also carry a real JWT, but
// phone+PIN ("token") sessions carry no Supabase session at all, only an
// x-engineer-token header validated against the same `users.session_token`
// check the DB's is_valid_engineer_token() RLS helper uses. Both paths are
// checked here (in that order) since either identifies a real logged-in
// user.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-engineer-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const REWRITE_PROMPT = `You clean up rushed, informal notes a tradesperson typed on-site (often missing punctuation, mixed capitalization, shorthand). Rewrite the note below into clear, professional English:
- Keep every technical fact, measurement, part name, and observation exactly as given — never invent, guess, or add anything not stated.
- Fix grammar, spelling, and punctuation.
- If it describes more than one distinct issue/task, format as a short bullet list; otherwise a single clear paragraph is fine.
- Return ONLY the rewritten text — no preamble, no quotes around it, no "Here's the rewrite:".

Note:
"""
{TEXT}
"""`;

async function tryGemini(text: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: REWRITE_PROMPT.replace('{TEXT}', text) }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const rewritten: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rewritten) throw new Error('Gemini returned no content');
  return rewritten.trim();
}

async function isAuthed(req: Request): Promise<boolean> {
  const supabase = createClient(SB_URL, SERVICE_KEY);

  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const { data } = await supabase.auth.getUser(authHeader.slice(7));
    if (data?.user) return true;
  }

  const engToken = req.headers.get('x-engineer-token');
  if (engToken) {
    const nowSecs = Math.floor(Date.now() / 1000);
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('session_token', engToken)
      .eq('role', 'engineer')
      .eq('active', true)
      .gt('session_expires', nowSecs)
      .limit(1);
    if (data && data.length) return true;
  }

  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!(await isAuthed(req))) return json({ error: 'Not authorized' }, 401);

  let body: { text?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const text = (body.text || '').trim();
  if (!text) return json({ error: 'text is required' }, 400);
  if (text.length > 4000) return json({ error: 'Text too long (4000 characters max)' }, 400);

  if (!GEMINI_API_KEY) {
    return json({ error: 'AI rewrite is not configured yet — ask the office to add a Gemini API key.' }, 503);
  }

  try {
    return json({ rewritten: await tryGemini(text) });
  } catch (e) {
    return json({ error: `Rewrite failed: ${(e as Error).message}` }, 502);
  }
});
