import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { memberships } from "@/db/schema";
import { withTenant } from "@/server/db/tenant";
import { acceptInvitation, changeRole, inviteMember, removeMember } from "@/server/services/team";
import { replaceSchedule } from "@/server/services/schedule";

import {
  addStaff,
  admin,
  createTestOrg,
  createUser,
  type TestOrg,
  useCleanDatabase,
} from "./helpers";

describe("team management and server-side RBAC", () => {
  useCleanDatabase();
  let org: TestOrg;
  const owner = () => ({ orgId: org.orgId, userId: org.owner.id, role: "owner" as const });

  beforeEach(async () => {
    org = await createTestOrg("studio");
  });

  async function inviteAndAccept(email: string, role: "admin" | "staff") {
    const user = await createUser(email.split("@")[0]!, email);
    const { token } = await withTenant({ orgId: org.orgId }, (tx) =>
      inviteMember(tx, owner(), { email, role }),
    );
    await acceptInvitation(token, user);
    const [m] = await admin`select id from memberships where user_id = ${user.id}`;
    return { user, membershipId: m!.id as string };
  }

  it("an invited user joins with the invited role and becomes bookable staff", async () => {
    const { user } = await inviteAndAccept("sam@example.com", "staff");
    const [m] = await admin`select role from memberships where user_id = ${user.id}`;
    expect(m!.role).toBe("staff");
    const [s] = await admin`select active from staff_members where user_id = ${user.id}`;
    expect(s!.active).toBe(true);
    const actions =
      await admin`select action from audit_log where org_id = ${org.orgId} order by id`;
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(["member.invited", "member.joined"]),
    );
  });

  it("an invitation can't be accepted by a different email or twice", async () => {
    const intruder = await createUser("Mallory", "mallory@example.com");
    const { token } = await withTenant({ orgId: org.orgId }, (tx) =>
      inviteMember(tx, owner(), { email: "sam@example.com", role: "staff" }),
    );
    await expect(acceptInvitation(token, intruder)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sam = await createUser("Sam", "sam@example.com");
    await acceptInvitation(token, sam);
    await expect(acceptInvitation(token, sam)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only a hash of the invitation token is stored", async () => {
    const { token } = await withTenant({ orgId: org.orgId }, (tx) =>
      inviteMember(tx, owner(), { email: "x@example.com", role: "staff" }),
    );
    const [row] = await admin`select token_hash from invitations`;
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("staff can't invite, admins can't create owners", async () => {
    const { user: staffUser } = await inviteAndAccept("staff@example.com", "staff");
    const { user: adminUser } = await inviteAndAccept("admin@example.com", "admin");
    await expect(
      withTenant({ orgId: org.orgId }, (tx) =>
        inviteMember(
          tx,
          { orgId: org.orgId, userId: staffUser.id, role: "staff" },
          { email: "a@b.co", role: "staff" },
        ),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [ownerMembership] =
      await admin`select id from memberships where user_id = ${org.owner.id}`;
    await expect(
      withTenant({ orgId: org.orgId }, (tx) =>
        changeRole(
          tx,
          { orgId: org.orgId, userId: adminUser.id, role: "admin" },
          { membershipId: ownerMembership!.id, role: "staff" },
        ),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the last owner can't be demoted or removed", async () => {
    const [m] = await withTenant({ orgId: org.orgId }, (tx) =>
      tx.select().from(memberships).where(eq(memberships.userId, org.owner.id)),
    );
    await expect(
      withTenant({ orgId: org.orgId }, (tx) =>
        changeRole(tx, owner(), { membershipId: m!.id, role: "admin" }),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      withTenant({ orgId: org.orgId }, (tx) => removeMember(tx, owner(), m!.id)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("removing a member keeps their history but makes them unbookable", async () => {
    const { user, membershipId } = await inviteAndAccept("leaving@example.com", "staff");
    await withTenant({ orgId: org.orgId }, (tx) => removeMember(tx, owner(), membershipId));
    expect(await admin`select * from memberships where user_id = ${user.id}`).toHaveLength(0);
    const [s] =
      await admin`select active, user_id from staff_members where email = 'leaving@example.com'`;
    expect(s).toMatchObject({ active: false, user_id: null });
  });

  it("staff can edit only their own schedule; admins can edit anyone's", async () => {
    const { user: staffUser } = await inviteAndAccept("own@example.com", "staff");
    const [own] = await admin`select id from staff_members where user_id = ${staffUser.id}`;
    const other = await addStaff(org, "Other");
    const schedule = { hours: [{ weekday: 1, start: "10:00", end: "14:00" }], breaks: [] };
    const asStaff = { orgId: org.orgId, userId: staffUser.id, role: "staff" as const };

    await withTenant({ orgId: org.orgId }, (tx) =>
      replaceSchedule(tx, asStaff, { staffId: own!.id, ...schedule }),
    );
    await expect(
      withTenant({ orgId: org.orgId }, (tx) =>
        replaceSchedule(tx, asStaff, { staffId: other.id, ...schedule }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTenant({ orgId: org.orgId }, (tx) =>
      replaceSchedule(tx, owner(), { staffId: other.id, ...schedule }),
    );
    const rows =
      await admin`select weekday, start_time::text, end_time::text from working_hours where staff_id = ${other.id}`;
    expect(rows).toEqual([{ weekday: 1, start_time: "10:00:00", end_time: "14:00:00" }]);
  });
});
