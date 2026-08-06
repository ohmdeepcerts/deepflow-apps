# Real push notifications — the sending side (Supabase Edge Function)

This is the one piece of this whole system that genuinely needs a small
server-side function — sending a Web Push message requires signing it with
the VAPID *private* key, which can never go into any HTML file the browser
downloads. Supabase Edge Functions are the free option for this (Deno
runtime, part of every Supabase project, free tier is 500K invocations/month
— nowhere near what a business this size would ever use).

I can't deploy this myself — I only have SQL Editor / REST API access to
your project, not the Edge Functions dashboard or CLI. You'll need to
create it yourself; I've written the exact code and steps below.

## Why this needs an extra check I don't usually add

By default, a Supabase Edge Function accepts any request carrying a validly
signed Supabase JWT — and **the public anon key itself is a validly signed
JWT** (it's just marked `role: anon`). That key is sitting in plain text in
every copy of this app's HTML source, same as always. Without an extra
check, anyone who copied that key out of the page source could call this
function directly and push a fake notification to any client, any time,
with no login at all — a spam vector, not a data breach, but a real one.

So the function itself checks that the caller is a genuinely logged-in
office or engineer account (`auth.getUser()` on their JWT — this fails for
the anon key, since there's no actual user behind it) before doing
anything. This mirrors the same anon-vs-authenticated boundary from
Phase 5C, just enforced in application code this time instead of a
database GRANT, since Edge Functions don't have Postgres-style REVOKE/GRANT.

## Step 1 — Create the function

If you don't have the Supabase CLI installed yet:

```
npm install -g supabase
supabase login
supabase link --project-ref dzqyqpuhxdrrpipbehpk
```

Then create the function:

```
supabase functions new send-push
```

This creates `supabase/functions/send-push/index.ts` — replace its
contents entirely with:

```typescript
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

  // Require a real logged-in office/engineer session — see "Why this needs
  // an extra check" above. The anon key alone will not pass this.
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
    const { title, message, url, landlordName, agencyName, agentName } = body;
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
          // 410/404 = the subscription is dead (browser data cleared, app
          // uninstalled) — clean it up so we stop retrying it forever.
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
```

## Step 2 — Set the VAPID keys as secrets

Never put these in the function file itself — secrets, not code:

```
supabase secrets set VAPID_PUBLIC_KEY=BCM7SAk356QodrcNAwoO7gOSwXnfGb7ooqN514kYfR8Fv72h1gbkMD23REa7toVURlZPqTTH8BfpWOJSqLRitTE
supabase secrets set VAPID_PRIVATE_KEY=rbO_aJZ2KV6IDHaKIAAOKPccja0L3w8WDpXbpCl-Rz8
```

(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
provided automatically to every Edge Function — you don't set those.)

## Step 3 — Deploy

```
supabase functions deploy send-push
```

This gives you a URL of the form:

```
https://dzqyqpuhxdrrpipbehpk.supabase.co/functions/v1/send-push
```

That exact URL is already what the app will call — I've hardcoded the
project ref into the trigger code since it's already public (it's in
`SB_URL`), so there's nothing further to configure once this is deployed.

## What I could and couldn't verify

I can't test this function myself — I have no deploy access, and there's no
way to simulate a real push arriving on a real device from this sandbox.
Once it's deployed, the most direct way to check it works: open the Client
Portal on your own phone, tap "Get notified on your phone" in the
notification bell, allow the permission prompt, then change a test job's
status from the Office App and watch for the push. Tell me once it's
deployed and I'll re-verify everything I *can* verify from my end (the
subscribe/unsubscribe RPCs, the trigger payloads, the settings toggle) the
same way I did for the PIN system.
