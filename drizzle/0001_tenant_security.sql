-- =============================================================================
-- Tenant security: RLS, the application role, the no-double-booking guarantee
-- and the few narrowly-scoped SECURITY DEFINER entry points.
--
-- Hand-written (drizzle-kit cannot express policies-on-settings, exclusion
-- constraints or definer functions). Runs as the migration owner.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 1. Application role
--    No SUPERUSER, no BYPASSRLS, does not own any table => RLS always applies.
--    `npm run db:migrate` grants it LOGIN + password from DATABASE_URL.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reservo_app') THEN
    CREATE ROLE reservo_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 2. Request context helpers
--    The app sets these with set_config(..., is_local => true) at the start of
--    every transaction, so they vanish on COMMIT/ROLLBACK and can never leak to
--    the next request that reuses the pooled connection. Unset => NULL =>
--    every policy below evaluates to false: the system fails closed.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO reservo_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO reservo_app;
--> statement-breakpoint

CREATE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.current_org', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.current_user', true), '') $$;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 3. Row Level Security on every tenant-owned table
--    FORCE makes the policies apply to the table owner too (defense in depth
--    for scripts that might run as the owner by mistake).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitations', 'staff_members', 'services', 'staff_services', 'working_hours',
    'breaks', 'date_overrides', 'time_off', 'holidays', 'customers', 'bookings',
    'payments', 'outbox', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (org_id = app.current_org_id())
         WITH CHECK (org_id = app.current_org_id())',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- Organizations: visible when it is the current tenant, or when the current
-- user is a member (needed for the org switcher). Writable only as current.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON public.organizations FOR SELECT
  USING (
    id = app.current_org_id()
    OR id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = app.current_user_id())
  );
--> statement-breakpoint
CREATE POLICY organizations_insert ON public.organizations FOR INSERT
  WITH CHECK (id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY organizations_update ON public.organizations FOR UPDATE
  USING (id = app.current_org_id())
  WITH CHECK (id = app.current_org_id());
--> statement-breakpoint

-- Memberships: a user can list their own memberships across orgs; everything
-- else is scoped to the current tenant.
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON public.memberships FOR SELECT
  USING (org_id = app.current_org_id() OR user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY memberships_insert ON public.memberships FOR INSERT
  WITH CHECK (org_id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON public.memberships FOR UPDATE
  USING (org_id = app.current_org_id())
  WITH CHECK (org_id = app.current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON public.memberships FOR DELETE
  USING (org_id = app.current_org_id());
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 4. Privileges (least privilege; note what is *missing*)
--    - organizations: no DELETE
--    - bookings: no DELETE (cancel instead; history is part of the product)
--    - audit_log: INSERT/SELECT only => append-only for the application
--    - webhook_events / rate_limits: global infra tables, no tenant data
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.auth_users, public.auth_sessions, public.auth_accounts, public.auth_verifications
  TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.organizations TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.memberships, public.invitations, public.staff_members, public.services,
     public.staff_services, public.working_hours, public.breaks, public.date_overrides,
     public.time_off, public.holidays, public.customers, public.payments
  TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.bookings TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.outbox TO reservo_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE public.outbox_id_seq TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_log TO reservo_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE public.audit_log_id_seq TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.webhook_events TO reservo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO reservo_app;
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 5. No double booking, guaranteed by the database
--    Two live bookings for the same staff member can never have overlapping
--    blocked ranges (appointment + buffers). Holds awaiting payment count too,
--    so two customers can't both reach checkout for the same slot.
--    btree_gist provides the `=` operator class for uuid inside a GiST index.
-- -----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(blocked_from, blocked_until, '[)') WITH &&
  )
  WHERE (status IN ('pending_payment', 'confirmed'));
--> statement-breakpoint

-- -----------------------------------------------------------------------------
-- 6. SECURITY DEFINER entry points
--    The only ways to cross the tenant boundary. Each one returns the minimum
--    (an id, or rows claimed for processing), pins search_path to defeat
--    object-shadowing attacks, and is executable by reservo_app only.
--    They run as the migration owner, which must be a superuser or BYPASSRLS.
-- -----------------------------------------------------------------------------

-- Public booking page: slug -> org id. Slugs are public by design.
CREATE FUNCTION app.org_id_by_slug(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT o.id FROM public.organizations o WHERE o.slug = p_slug $$;
--> statement-breakpoint

-- Invitation link: token hash -> org id, only for a live invitation.
CREATE FUNCTION app.invitation_org_id(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT i.org_id FROM public.invitations i
    WHERE i.token_hash = p_token_hash
      AND i.accepted_at IS NULL
      AND i.revoked_at IS NULL
      AND i.expires_at > now()
  $$;
--> statement-breakpoint

-- Outbox worker: lease a batch across all tenants. SKIP LOCKED lets several
-- workers run concurrently without double-claiming; a lease that expires
-- (worker crashed mid-delivery) makes the row claimable again.
CREATE FUNCTION app.claim_outbox(p_limit integer, p_lease_seconds integer)
  RETURNS SETOF public.outbox
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE public.outbox o
       SET status = 'processing',
           locked_until = now() + make_interval(secs => p_lease_seconds),
           attempts = o.attempts + 1
     WHERE o.id IN (
       SELECT c.id FROM public.outbox c
        WHERE c.attempts < c.max_attempts
          AND (
            (c.status = 'pending' AND c.available_at <= now())
            OR (c.status = 'processing' AND c.locked_until < now())
          )
        ORDER BY c.available_at, c.id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
     )
    RETURNING o.*
  $$;
--> statement-breakpoint

-- Messages whose lease expired on their final attempt would otherwise sit in
-- 'processing' forever; move them to the dead-letter state.
CREATE FUNCTION app.dead_letter_exhausted_outbox() RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH dead AS (
      UPDATE public.outbox
         SET status = 'dead', last_error = coalesce(last_error, 'lease expired on final attempt')
       WHERE status = 'processing' AND locked_until < now() AND attempts >= max_attempts
      RETURNING 1
    )
    SELECT count(*)::integer FROM dead
  $$;
--> statement-breakpoint

-- Releases slots held by abandoned checkouts, across all tenants.
CREATE FUNCTION app.expire_stale_holds() RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH expired AS (
      UPDATE public.bookings SET status = 'expired', updated_at = now()
       WHERE status = 'pending_payment' AND hold_expires_at <= now()
      RETURNING 1
    )
    SELECT count(*)::integer FROM expired
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.org_id_by_slug(text), app.invitation_org_id(text),
  app.claim_outbox(integer, integer), app.dead_letter_exhausted_outbox(), app.expire_stale_holds()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.org_id_by_slug(text), app.invitation_org_id(text),
  app.claim_outbox(integer, integer), app.dead_letter_exhausted_outbox(), app.expire_stale_holds(),
  app.current_org_id(), app.current_user_id()
  TO reservo_app;
