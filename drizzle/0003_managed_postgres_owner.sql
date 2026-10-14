-- =============================================================================
-- Managed Postgres (Neon, Supabase, RDS...): the migration owner is usually
-- NOT a superuser and may lack BYPASSRLS. With FORCE ROW LEVEL SECURITY that
-- owner is filtered like everyone else, so the SECURITY DEFINER entry points
-- (slug lookup, outbox claim, hold expiry) and the seed/reset scripts would
-- silently see zero rows.
--
-- When - and only when - the role running the migrations bypasses nothing,
-- give *that role* an explicit allow-all policy on every RLS table. The
-- application role `reservo_app` is NOINHERIT and never a member of the
-- owner, so tenant isolation for the app is unchanged. On a local/CI
-- superuser this migration is a no-op.
-- =============================================================================

DO $$
DECLARE
  t text;
  privileged boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO privileged FROM pg_roles WHERE rolname = current_user;
  IF privileged THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'organizations', 'memberships', 'invitations', 'staff_members', 'services',
    'staff_services', 'working_hours', 'breaks', 'date_overrides', 'time_off', 'holidays',
    'customers', 'bookings', 'payments', 'outbox', 'audit_log'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY owner_maintenance ON public.%I TO %I USING (true) WITH CHECK (true)',
      t, current_user
    );
  END LOOP;
END
$$;
