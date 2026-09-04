import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Two supported callers while Client Portal V2's session migration is in
// progress (docs/architecture/08-authentication-and-roles.md predates this):
//  - Legacy: {type, id, paths} — the same (type, id) the old portal_get_*(p_id)
//    RPCs trust, kept working unchanged until apps/portal/*.js stops sending it.
//  - New: an `x-portal-session` header + {paths} — resolves identity from a
//    real server-side session via the new portal_get_*() overloads instead of
//    trusting a client-supplied id at all.
// Either way, a requested path is only ever signed if it's actually found
// among that identity's own jobs/certs/attachments/invoices — a guessed or
// adjacent path that isn't genuinely theirs is silently dropped, never signed.
const EXPIRES_IN = 21600; // 6 hours — long enough for one portal visit, short enough that a copied link goes stale

// A cert is locked until every invoice linked to its job is Paid, UNLESS the
// client's lockcertsuntilpaid toggle (apps/office Directory) is off — matching
// apps/office/certs-pdf.js's _isJobPaid and apps/portal/certs.js's
// _isCertLocked exactly. This used to be a 3rd, independent copy that only
// checked the Paid rule and never looked at the toggle at all, so turning a
// client's certs unlocked in Directory left the real signed file still
// refused here — the UI showed unlocked, the actual download stayed locked.
// That's the bug this fixes: while genuinely locked, the real signed URL is
// never handed to the browser in the first place, here, regardless of which
// function the client calls afterward — the client-side check alone isn't
// real enforcement (previewCertPdf is reachable directly from devtools).
function isCertLocked(cert: any, invoices: any[], lockCertsUntilPaid: boolean): boolean {
  if (lockCertsUntilPaid === false) return false;
  if (!cert.jobid) return false;
  const linked = invoices.filter((i) => i.jobid === cert.jobid || i.linkedjobid === cert.jobid);
  return linked.length === 0 || !linked.every((i) => i.status === 'Paid');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { type, id, paths } = await req.json();
    if (!Array.isArray(paths) || !paths.length) {
      return new Response(JSON.stringify({ error: 'paths[] is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sessionToken = req.headers.get('x-portal-session');
    const useSession = !!sessionToken && !type && !id;
    if (!useSession && (!type || !id)) {
      return new Response(JSON.stringify({ error: 'type and id are required (or send x-portal-session)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = useSession
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { headers: { 'x-portal-session': sessionToken! } } })
      : createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const entityRpc = useSession
      ? null // resolved below per-type once we know which table the session belongs to
      : type === 'landlord' ? 'portal_get_person' : type === 'agency' ? 'portal_get_agency' : type === 'agent' ? 'portal_get_agent' : null;

    let lockCertsUntilPaid = true;
    let jobs: any[] = [], invoices: any[] = [], certs: any[] = [], atts: any[] = [];

    if (useSession) {
      const [j, inv, c, a, per, ag1, ag2] = await Promise.all([
        supabase.rpc('portal_get_jobs'),
        supabase.rpc('portal_get_invoices'),
        supabase.rpc('portal_get_certs'),
        supabase.rpc('portal_get_attachments'),
        supabase.rpc('portal_get_person'),
        supabase.rpc('portal_get_agency'),
        supabase.rpc('portal_get_agent'),
      ]);
      jobs = j.data || []; invoices = inv.data || []; certs = c.data || []; atts = a.data || [];
      const entity = (per.data?.[0]) || (ag1.data?.[0]) || (ag2.data?.[0]);
      if (entity && entity.lockcertsuntilpaid === false) lockCertsUntilPaid = false;
    } else {
      const { data: jobsData } = await supabase.rpc('portal_get_jobs', { p_type: type, p_id: id });
      jobs = jobsData || [];
      const jobIds = jobs.map((j: any) => j.id);
      const { data: invData } = await supabase.rpc('portal_get_invoices', { p_type: type, p_id: id });
      invoices = invData || [];
      if (jobIds.length) {
        const { data: certsData } = await supabase.rpc('portal_get_certs', { p_job_ids: jobIds });
        certs = certsData || [];
        const { data: attsData } = await supabase.rpc('portal_get_attachments', { p_job_ids: jobIds });
        atts = attsData || [];
      }
      if (entityRpc) {
        const { data: entityData } = await supabase.rpc(entityRpc, { p_id: id });
        const entity = entityData?.[0];
        if (entity && entity.lockcertsuntilpaid === false) lockCertsUntilPaid = false;
      }
    }

    const allowedPaths = new Set<string>();
    const lockedPaths = new Set<string>();
    for (const c of certs) {
      if (!c.pdf_path) continue;
      if (isCertLocked(c, invoices, lockCertsUntilPaid)) lockedPaths.add(c.pdf_path);
      else allowedPaths.add(c.pdf_path);
    }
    for (const a of atts) if (a.storage_path) allowedPaths.add(a.storage_path);
    for (const inv of invoices) if (inv.pdf_path) allowedPaths.add(inv.pdf_path);

    const urls: Record<string, string | null> = {};
    for (const path of paths) {
      if (typeof path !== 'string' || lockedPaths.has(path) || !allowedPaths.has(path)) { urls[path] = null; continue; }
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
