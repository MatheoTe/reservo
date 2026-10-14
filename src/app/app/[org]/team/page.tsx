import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { canAssignRole, ROLE_LABEL } from "@/server/auth/rbac";
import { getOrgContext, readInOrg } from "@/server/context";
import { listStaff } from "@/server/services/catalog";
import { getSchedule } from "@/server/services/schedule";
import { listTeam } from "@/server/services/team";

import { InviteForm, MemberActions, RevokeInvite } from "./member-controls";
import { ScheduleEditor } from "./schedule-editor";

export default async function TeamPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const manageTeam = ctx.can("team:manage");
  if (!manageTeam && !ctx.can("schedule:manage:own")) notFound();

  const data = await readInOrg(ctx, async (tx) => {
    const staff = await listStaff(tx, { activeOnly: true });
    const editable = ctx.can("schedule:manage:any")
      ? staff
      : staff.filter((s) => s.id === ctx.staffId);
    const schedules = await Promise.all(
      editable.map(async (s) => ({ staff: s, schedule: await getSchedule(tx, s.id) })),
    );
    return { team: manageTeam ? await listTeam(tx) : null, schedules };
  });

  return (
    <>
      <PageHeader title="Team" description="Members, roles and working hours." />
      {data.team ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH>Role</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {data.team.members.map((m) => (
                  <TR key={m.membershipId}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <div>
                          <p className="font-medium">
                            {m.name}{" "}
                            {m.userId === ctx.user.id ? (
                              <span className="text-muted-foreground text-xs">(you)</span>
                            ) : null}
                          </p>
                          <p className="text-muted-foreground text-xs">{m.email}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <Badge variant={m.role === "owner" ? "default" : "outline"}>
                        {ROLE_LABEL[m.role]}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      {m.userId !== ctx.user.id && canAssignRole(ctx.role, m.role, m.role) ? (
                        <MemberActions
                          orgSlug={slug}
                          membershipId={m.membershipId}
                          name={m.name}
                          role={m.role}
                          assignable={(["owner", "admin", "staff"] as const).filter((r) =>
                            canAssignRole(ctx.role, m.role, r),
                          )}
                        />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
              <CardDescription>
                They&apos;ll get an email with a link that expires in 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <InviteForm orgSlug={slug} canInviteAdmin={canAssignRole(ctx.role, null, "admin")} />
              {data.team.pending.length > 0 ? (
                <div className="grid gap-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Pending
                  </p>
                  {data.team.pending.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {i.email}{" "}
                        <span className="text-muted-foreground">· {ROLE_LABEL[i.role]}</span>
                      </span>
                      <RevokeInvite orgSlug={slug} invitationId={i.id} />
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold tracking-tight">Working hours</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        In {ctx.org.timeZone.replaceAll("_", " ")}. Add a break to split the day.
      </p>
      <div className="grid gap-4">
        {data.schedules.map(({ staff, schedule }) => (
          <ScheduleEditor
            key={staff.id}
            orgSlug={slug}
            staff={{ id: staff.id, name: staff.displayName, color: staff.color }}
            initialHours={schedule.hours}
            initialBreaks={schedule.breaks}
          />
        ))}
      </div>
    </>
  );
}
