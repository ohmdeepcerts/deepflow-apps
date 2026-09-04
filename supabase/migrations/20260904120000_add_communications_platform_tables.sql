-- Communications platform — Phase A (docs/communications/08-IMPLEMENTATION-PLAN.md).
-- Purely additive: eight new tables, zero change to any existing table, function,
-- or behaviour. Nothing in the app calls any of this yet — see the implementation
-- plan for the phase sequence that actually wires these up.
--
-- Design choices carried over from the existing schema, confirmed by reading it
-- directly rather than assumed: `text PRIMARY KEY` app-generated ids (matching
-- jobs/invoices/activity), RLS enabled with is_office()-gated policies for the
-- staff-facing tables, and the push_subscriptions pattern (RLS enabled, zero direct
-- policies, SECURITY DEFINER RPC as the only door in) for the one Portal-facing
-- table here (notifications) — Portal has no Supabase Auth session to write a normal
-- policy against, same reason portal_get_jobs/portal_get_invoices work the way they
-- do (see docs/communications/02-COMMUNICATIONS-ARCHITECTURE.md §4).

-- ---------------------------------------------------------------------------
-- conversations — one row per WhatsApp thread
-- ---------------------------------------------------------------------------
CREATE TABLE public.conversations (
  id                      text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_phone           text NOT NULL,
  contact_type            text NOT NULL DEFAULT 'unknown'
                            CHECK (contact_type IN ('customer','staff','engineer','supplier','unknown')),
  client_table            text,  -- 'persons' | 'agencies' | 'agents', nullable until matched
  client_id               text,
  job_id                  text REFERENCES public.jobs(id) ON DELETE SET NULL,
  invoice_id              text REFERENCES public.invoices(id) ON DELETE SET NULL,
  certificate_id          text,
  ai_enabled              boolean NOT NULL DEFAULT true,
  ai_send_mode            text NOT NULL DEFAULT 'review'
                            CHECK (ai_send_mode IN ('auto','review','off')),
  human_takeover          boolean NOT NULL DEFAULT false,
  current_intent          text,
  context_summary         text,
  collected_fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields          jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_customer_message_at timestamptz,
  last_business_message_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_contact_phone ON public.conversations(contact_phone);
CREATE INDEX idx_conversations_job_id ON public.conversations(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_conversations_invoice_id ON public.conversations(invoice_id) WHERE invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- messages — one row per WhatsApp message, either direction
-- ---------------------------------------------------------------------------
CREATE TABLE public.messages (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id     text NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  channel             text NOT NULL DEFAULT 'whatsapp',
  provider            text NOT NULL DEFAULT 'meta'
                        CHECK (provider IN ('meta','twilio_legacy')),
  direction           text NOT NULL CHECK (direction IN ('in','out')),
  sender              text NOT NULL CHECK (sender IN ('customer','ai','human','system')),
  body                text,
  media_url           text,
  provider_message_id text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','delivered','read','failed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
-- Idempotency: a given provider message can only ever be recorded once — this is
-- the concrete mechanism behind docs/communications/05-SECURITY-PRIVACY.md §2's
-- "dedupe before insert, not after" webhook-retry requirement.
CREATE UNIQUE INDEX idx_messages_provider_message_id ON public.messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- notifications — persisted Client Portal notifications (replaces the current
-- in-memory-only "changes since last visit" list in apps/portal/main.js)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_table  text NOT NULL,  -- 'persons' | 'agencies' | 'agents' — same convention as push_subscriptions
  entity_id     text NOT NULL,
  type          text NOT NULL,
  title         text NOT NULL,
  body          text,
  link          text,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_entity ON public.notifications(entity_table, entity_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- comm_events — the event queue (business code inserts, a scheduled processor
-- reads/actions — see docs/communications/02-COMMUNICATIONS-ARCHITECTURE.md §5-6)
-- ---------------------------------------------------------------------------
CREATE TABLE public.comm_events (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type      text NOT NULL,
  entity_table    text,
  entity_id       text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processed','suppressed','failed')),
  dedupe_key      text,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comm_events_status_created ON public.comm_events(status, created_at) WHERE status = 'pending';
-- Idempotency at the event level: the same event_type for the same entity with the
-- same dedupe_key (e.g. a specific due-date sweep run) can't be queued twice.
CREATE UNIQUE INDEX idx_comm_events_dedupe ON public.comm_events(event_type, entity_table, entity_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- comm_suppressions — audit trail of why an automated send didn't happen
-- ---------------------------------------------------------------------------
CREATE TABLE public.comm_suppressions (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  comm_event_id text REFERENCES public.comm_events(id) ON DELETE CASCADE,
  channel       text NOT NULL,
  reason        text NOT NULL,  -- GLOBAL_PAUSE | QUIET_HOURS | RATE_LIMIT | PROMISE_ACTIVE | ... (see BRD)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comm_suppressions_event ON public.comm_suppressions(comm_event_id);

-- ---------------------------------------------------------------------------
-- client_comm_preferences — per-client channel on/off + AI mode override
-- ---------------------------------------------------------------------------
CREATE TABLE public.client_comm_preferences (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_table  text NOT NULL,  -- 'persons' | 'agencies' | 'agents'
  client_id     text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL','PORTAL','PUSH')),
  enabled       boolean NOT NULL DEFAULT true,
  ai_mode       text CHECK (ai_mode IN ('auto','review','off')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_table, client_id, channel)
);

-- ---------------------------------------------------------------------------
-- payment_chase_state — one row per invoice under active/past chasing
-- ---------------------------------------------------------------------------
CREATE TABLE public.payment_chase_state (
  invoice_id      text PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  stage           int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','promised','claimed','disputed','escalated','stopped')),
  promise_date    date,
  last_contact_at timestamptz,
  next_scheduled_at timestamptz,
  reminders_sent  int NOT NULL DEFAULT 0,
  paused_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_chase_state_next_scheduled ON public.payment_chase_state(next_scheduled_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- comm_templates — per-event, per-channel templates (seed data migrates the
-- existing flat S.wa*Tpl settings strings in a later phase, not here)
-- ---------------------------------------------------------------------------
CREATE TABLE public.comm_templates (
  id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type          text NOT NULL,
  channel             text NOT NULL CHECK (channel IN ('WHATSAPP','EMAIL','PORTAL','PUSH')),
  subject             text,  -- email only
  body                text NOT NULL,
  meta_template_name  text,  -- WhatsApp only, once submitted to Meta for approval
  meta_category       text CHECK (meta_category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  approval_status     text NOT NULL DEFAULT 'draft'
                        CHECK (approval_status IN ('draft','submitted','approved','rejected')),
  is_active           boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  UNIQUE (event_type, channel)
);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_comm_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_chase_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_templates ENABLE ROW LEVEL SECURITY;

-- Office: full access to everything except notifications (Portal-only, RPC-gated
-- below — no direct policy, same as push_subscriptions has none).
CREATE POLICY conversations_office_all ON public.conversations FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());
CREATE POLICY messages_office_all ON public.messages FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());
CREATE POLICY comm_events_office_all ON public.comm_events FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());
CREATE POLICY comm_suppressions_office_select ON public.comm_suppressions FOR SELECT TO authenticated
  USING (is_office());
CREATE POLICY client_comm_preferences_office_all ON public.client_comm_preferences FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());
CREATE POLICY payment_chase_state_office_all ON public.payment_chase_state FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());
CREATE POLICY comm_templates_office_all ON public.comm_templates FOR ALL TO authenticated
  USING (is_office()) WITH CHECK (is_office());

-- notifications: deliberately no policy for any role — matches push_subscriptions.
-- Portal reads/writes exclusively through portal_get_notifications() and
-- portal_mark_notification_read() below (SECURITY DEFINER, bypasses RLS by design,
-- same mechanism as every existing portal_get_* function). Office gets read access
-- for support/audit purposes only.
CREATE POLICY notifications_office_select ON public.notifications FOR SELECT TO authenticated
  USING (is_office());

-- ============================================================================
-- Portal RPCs for notifications — same shape as the existing portal_get_jobs/
-- portal_get_invoices (p_type/p_id, SECURITY DEFINER, no mandatory PIN check
-- inside the function itself, consistent with every other portal_get_* function
-- in this schema — see docs/communications/05-SECURITY-PRIVACY.md §3 for why
-- this is a deliberate match to existing behaviour, not a new weaker path).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.portal_get_notifications(p_type text, p_id text)
 RETURNS SETOF notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_table text;
BEGIN
  v_table := CASE p_type WHEN 'landlord' THEN 'persons' WHEN 'agency' THEN 'agencies' WHEN 'agent' THEN 'agents' ELSE NULL END;
  IF v_table IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM notifications
    WHERE entity_table = v_table AND entity_id = p_id
    ORDER BY created_at DESC
    LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_mark_notification_read(p_type text, p_id text, p_notification_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_table text;
BEGIN
  v_table := CASE p_type WHEN 'landlord' THEN 'persons' WHEN 'agency' THEN 'agencies' WHEN 'agent' THEN 'agents' ELSE NULL END;
  IF v_table IS NULL THEN RETURN; END IF;
  -- entity_table/entity_id in the WHERE clause is what stops one Portal visitor
  -- marking (or even discovering the existence of) another entity's notification —
  -- p_notification_id alone is not trusted.
  UPDATE notifications SET read_at = now()
    WHERE id = p_notification_id AND entity_table = v_table AND entity_id = p_id AND read_at IS NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.portal_get_notifications(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_mark_notification_read(text, text, text) TO anon, authenticated;
