import type { MemberRole } from "@/db/schema";

/**
 * Role-based access control. Permissions are checked on the server for every
 * mutation; the UI only *hides* things based on the same table.
 */
export const PERMISSIONS = [
  "bookings:read",
  "bookings:write:own", // staff: bookings assigned to themselves
  "bookings:write:any",
  "customers:read",
  "customers:write",
  "services:manage",
  "schedule:manage:own",
  "schedule:manage:any",
  "team:manage",
  "settings:manage",
  "billing:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF: Permission[] = [
  "bookings:read",
  "bookings:write:own",
  "customers:read",
  "schedule:manage:own",
];

const ADMIN: Permission[] = [
  ...STAFF,
  "bookings:write:any",
  "customers:write",
  "services:manage",
  "schedule:manage:any",
  "team:manage",
  "settings:manage",
  "audit:read",
];

const OWNER: Permission[] = [...ADMIN, "billing:manage"];

const MATRIX: Record<MemberRole, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  staff: new Set(STAFF),
};

export function can(role: MemberRole, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

const RANK: Record<MemberRole, number> = { staff: 0, admin: 1, owner: 2 };

/**
 * Who may assign which role to whom:
 *  - owners can do anything except leave the org without an owner (checked by the caller)
 *  - admins manage staff and other admins, but can't touch owners or create them
 *  - staff can't manage roles at all
 */
export function canAssignRole(
  actor: MemberRole,
  targetCurrent: MemberRole | null,
  next: MemberRole,
): boolean {
  if (!can(actor, "team:manage")) return false;
  if (actor === "owner") return true;
  if (next === "owner") return false;
  if (targetCurrent !== null && RANK[targetCurrent] > RANK[actor]) return false;
  return RANK[next] <= RANK[actor];
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};
