// Reads a photo of a certificate and pulls out cert number, issue/expiry
// date, and cert type, to pre-fill the Add Certificate form instead of
// typing it all by hand. Tries Gemini first (multimodal — one call reads
// the image AND returns structured fields); falls back to OCR.space
// (text-only, no field extraction) whenever Gemini can't be used:
//   - the caller's Settings toggle for AI extraction is off (preferGemini
//     is sent as false), or
//   - GEMINI_API_KEY isn't configured as an Edge Function secret, or
//   - the Gemini call itself fails for any reason (bad response, rate
//     limit, network error) — never leave the user with nothing just
//     because the primary path had a bad moment.
//
// Auth: Office App only, via a Supabase Auth JWT (checked manually, same
// pattern as send-email).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const OCR_SPACE_API_KEY = Deno.env.get('OCR_SPACE_API_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const EXTRACT_PROMPT = `This image is a UK electrical/gas compliance certificate (EICR, Gas Safety Record, PAT test, etc). Read it and return ONLY a JSON object with these exact keys (use null for anything you can't find, don't guess): {"certNum": string|null, "certType": string|null, "issueDate": "YYYY-MM-DD"|null, "expiryDate": "YYYY-MM-DD"|null, "propertyAddress": string|null}. certType should be one of: "EICR", "Gas Safety", "PAT Testing", "EPC", or the closest short label if none match.`;

// Reads a photographed (often handwritten) PAT appliance test log — a
// table of asset numbers and item descriptions — rather than a single
// certificate's header fields. Instrument/date/retest-period/result are
// deliberately NOT asked for here: on a real paper log those are almost
// always constant across the whole sheet rather than written per row, so
// the caller fills them in once via the bulk-add defaults instead of
// guessing them per appliance.
const EXTRACT_APPLIANCES_PROMPT = `This image is a handwritten or printed PAT (Portable Appliance Test) log — a table or list of electrical appliances, each with an asset number and a description. Read every row and return ONLY a JSON object with this exact shape: {"appliances": [{"assetId": string|null, "description": string|null, "result": "Pass"|"Fail"|null}]}. Include one entry per row in the order they appear. Only set "result" if a pass/fail mark is actually visible for that row (a tick, cross, "P"/"F", circle, etc) — otherwise use null. Skip a row only if it's entirely blank. Don't guess illegible text — use null for that field instead.`;

async function tryGemini(imageBase64: string, mimeType: string, prompt: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json' },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');
  const fields = JSON.parse(text);
  return { source: 'gemini', ...fields };
}

async function tryOcrSpace(imageBase64: string, mimeType: string) {
  const form = new FormData();
  form.set('apikey', OCR_SPACE_API_KEY!);
  form.set('base64Image', `data:${mimeType};base64,${imageBase64}`);
  form.set('OCREngine', '2');
  const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`OCR.space ${res.status}`);
  const data = await res.json();
  const rawText: string = data?.ParsedResults?.[0]?.ParsedText || '';
  if (!rawText) throw new Error('OCR.space returned no text');
  return { source: 'ocr', rawText };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Not authorized' }, 401);
  const supabase = createClient(SB_URL, SERVICE_KEY);
  const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
  if (!userData?.user) return json({ error: 'Not authorized' }, 401);

  let body: { imageBase64?: string; mimeType?: string; preferGemini?: boolean; mode?: 'cert' | 'appliances' };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { imageBase64, mimeType, preferGemini, mode } = body;
  if (!imageBase64 || !mimeType) return json({ error: 'imageBase64 and mimeType are required' }, 400);

  const wantGemini = preferGemini !== false && !!GEMINI_API_KEY;
  const prompt = mode === 'appliances' ? EXTRACT_APPLIANCES_PROMPT : EXTRACT_PROMPT;

  if (wantGemini) {
    try {
      return json(await tryGemini(imageBase64, mimeType, prompt));
    } catch (_e) {
      // fall through to OCR — Gemini being down/rate-limited shouldn't
      // leave the user with nothing.
    }
  }

  if (OCR_SPACE_API_KEY) {
    try {
      return json(await tryOcrSpace(imageBase64, mimeType));
    } catch (e) {
      return json({ error: `OCR fallback also failed: ${(e as Error).message}` }, 502);
    }
  }

  return json({ error: 'AI extraction is not configured yet — ask the office to add a Gemini or OCR.space API key.' }, 503);
});
