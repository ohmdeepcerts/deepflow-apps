import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails('mailto:admin@deepflow.local', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Require a real logged-in office/engineer session. The public anon key
  // is a validly-signed JWT too (role: anon) and would otherwise pass
  // Supabase's own default verify_jwt check, letting anyone who copied the
  // anon key out of the app's source spam a client's phone with fake
  // pushes. auth.getUser() fails for the anon key since there's no real
  // user session behind it.
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { title, message, url, landlordName, agencyName, agentName, staffName, staffRoles } = body;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const entities: { table: string; id: string }[] = [];
    if (landlordName) {
      const { data } = await supabase.from('persons').select('id').ilike('name', landlordName).limit(1);
      if (data?.[0]) entities.push({ table: 'persons', id: data[0].id });
    }
    if (agencyName) {
      const { data } = await supabase.from('agencies').select('id').ilike('name', agencyName).limit(1);
      if (data?.[0]) entities.push({ table: 'agencies', id: data[0].id });
    }
    if (agentName) {
      const { data } = await supabase.from('agents').select('id').ilike('name', agentName).limit(1);
      if (data?.[0]) entities.push({ table: 'agents', id: data[0].id });
    }
    // Staff (Office/Engineer) targeting — a name for "this one engineer"
    // (e.g. the job's assigned engineer), or a list of roles for "everyone
    // who can act on this" (e.g. admin/manager reviewing a completed job).
    // Client (landlord/agency/agent) entities above are matched by a
    // single fuzzy name since that's all the caller has; staff are looked
    // up by exact users.name/role since the caller already knows exactly
    // who should be notified.
    if (staffName) {
      const { data } = await supabase.from('users').select('id').eq('name', staffName).eq('active', true).limit(1);
      if (data?.[0]) entities.push({ table: 'users', id: data[0].id });
    }
    if (Array.isArray(staffRoles) && staffRoles.length) {
      const { data } = await supabase.from('users').select('id').in('role', staffRoles).eq('active', true);
      for (const row of data || []) entities.push({ table: 'users', id: row.id });
    }

    if (!entities.length) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no matching client found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let sent = 0, removed = 0;
    for (const entity of entities) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('entity_table', entity.table)
        .eq('entity_id', entity.id);

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: title || 'DeepFlow', body: message || 'You have an update', url: url || '/' })
          );
          sent++;
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            removed++;
          }
        }
      }
    }

    return new Response(JSON.stringify({ sent, removed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
