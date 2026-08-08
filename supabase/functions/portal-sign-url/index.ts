import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Portal has no session at all (see docs/architecture/08-authentication-and-roles.md)
// — every visit is just ?type=&id= resolved server-side by the portal_get_*
// RPCs. Now that the `deepflow` bucket is private, Portal can no longer read
// a stored public URL directly, and it has no auth context to call
// createSignedUrl() itself either. This function is the bridge: given the
// same (type, id) the portal_get_* RPCs already trust, it re-resolves that
// identity's own jobs/certs/attachments/invoices with the service role
// (bypassing RLS, same as those RPCs do internally) and only signs a
// requested path if it's actually found among that identity's own records —
// a guessed or adjacent path that isn't genuinely theirs is silently
// dropped, never signed.
const EXPIRES_IN = 21600; // 6 hours — long enough for one portal visit, short enough that a copied link goes stale

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { type, id, paths } = await req.json();
    if (!type || !id || !Array.isArray(paths) || !paths.length) {
      return new Response(JSON.stringify({ error: 'type, id, and paths[] are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: jobs } = await supabase.rpc('portal_get_jobs', { p_type: type, p_id: id });
    const jobIds = (jobs || []).map((j: any) => j.id);

    const allowedPaths = new Set<string>();
    if (jobIds.length) {
      const { data: certs } = await supabase.rpc('portal_get_certs', { p_job_ids: jobIds });
      for (const c of certs || []) if (c.pdf_path) allowedPaths.add(c.pdf_path);
      const { data: atts } = await supabase.rpc('portal_get_attachments', { p_job_ids: jobIds });
      for (const a of atts || []) if (a.storage_path) allowedPaths.add(a.storage_path);
    }
    const { data: invoices } = await supabase.rpc('portal_get_invoices', { p_type: type, p_id: id });
    for (const inv of invoices || []) if (inv.pdf_path) allowedPaths.add(inv.pdf_path);

    const urls: Record<string, string | null> = {};
    for (const path of paths) {
      if (typeof path !== 'string' || !allowedPaths.has(path)) { urls[path] = null; continue; }
      const { data, error } = await supabase.storage.from('deepflow').createSignedUrl(path, EXPIRES_IN);
      urls[path] = error ? null : data.signedUrl;
    }

    return new Response(JSON.stringify({ urls }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
