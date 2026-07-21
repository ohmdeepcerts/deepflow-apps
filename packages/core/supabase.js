// The Supabase connection — URL, anon key, and the raw REST fetch
// primitive. Previously duplicated independently in all three apps (see
// ARCHITECTURE_REDESIGN_PROPOSAL.md §1.2/1.8); this is now the one place
// these are declared.
//
// Deliberately narrow scope: `restFetch` only unifies the part that was
// genuinely byte-identical in effect across all three apps' fetch calls —
// URL construction, header shape, and JSON (de)serialization. Auth-token
// resolution, error-message formatting, sync-state side effects, and
// result post-processing differ per app today (confirmed by reading all
// three implementations directly, not assumed) and are deliberately left
// to each app's own thin wrapper — real unification of those is later,
// deliberate work (Phase 2/3), not a side effect of this extraction.
import { createClient } from '@supabase/supabase-js';

export const SB_URL = 'https://dzqyqpuhxdrrpipbehpk.supabase.co';
export const SB_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6cXlxcHVoeGRycnBpcGJlaHBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzYzMjksImV4cCI6MjA4ODQ1MjMyOX0.7ObsuqKv5gNX5r7Pz1x1gyGgugcX2W0zw3d9hC6osvI';

// Replaces the `<script src=".../supabase.js">` CDN tag previously loaded
// independently by index.html and engineer.html (client-portal.html never
// loaded it — it has no Supabase Auth session concept at all, see
// ARCHITECTURE_REDESIGN_PROPOSAL.md §1.8). Same library, same version line;
// only how it's loaded changes (bundled instead of a global `window.supabase`
// that could silently fail if the CDN request failed).
export function createSupaAuthClient() {
  return createClient(SB_URL, SB_KEY);
}

// Shared by index.html's _getJWT() and engineer.html's _getJWT() — resolves
// the current session's access token, falling back to the anon key if
// there's no session or the lookup fails. client-portal.html never uses
// this (it always authenticates as anon — see supabase.js module doc above).
export function makeJwtResolver(supaAuthClient) {
  return async function getJWT() {
    try {
      const { data } = await supaAuthClient.auth.getSession();
      return data?.session?.access_token || SB_KEY;
    } catch (e) {
      return SB_KEY;
    }
  };
}

// The raw REST call. Returns the fetch Response unread — each app's wrapper
// reads the body and throws on failure in its own existing style (the three
// apps format error messages differently today; preserving that exactly,
// not collapsing it here).
export async function restFetch(path, opts = {}, authToken = SB_KEY) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: 'Bearer ' + authToken,
      'Content-Type': 'application/json',
      Prefer:
        opts.prefer ||
        (opts.method === 'PATCH'
          ? 'return=minimal'
          : opts.method === 'POST'
            ? 'return=representation'
            : ''),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
