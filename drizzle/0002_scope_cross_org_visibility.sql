-- =============================================================================
-- Security fix: a user's memberships in *other* organizations were visible
-- inside a tenant transaction (policy: org_id = current_org OR user_id =
-- current_user). A membership lookup that forgot to filter by org could then
-- pick up the user's role from org A while operating on org B.
--
-- Cross-org visibility is now only granted in a *user-only* context (no
-- tenant bound), which is what the org switcher uses. Inside a tenant, both
-- tables are strictly scoped to that tenant, so even an unfiltered query
-- cannot leak or borrow a role from another organization.
-- =============================================================================

DROP POLICY memberships_select ON public.memberships;
--> statement-breakpoint
CREATE POLICY memberships_select ON public.memberships FOR SELECT
  USING (
    org_id = app.current_org_id()
    OR (app.current_org_id() IS NULL AND user_id = app.current_user_id())
  );
--> statement-breakpoint

DROP POLICY organizations_select ON public.organizations;
--> statement-breakpoint
CREATE POLICY organizations_select ON public.organizations FOR SELECT
  USING (
    id = app.current_org_id()
    OR (
      app.current_org_id() IS NULL
      AND id IN (SELECT m.org_id FROM public.memberships m WHERE m.user_id = app.current_user_id())
    )
  );
