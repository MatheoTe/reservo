/**
 * Database schema.
 *
 * Conventions
 *  - Every tenant-owned table carries `org_id` and is protected by Row Level
 *    Security (see drizzle/0001_tenant_security.sql). Application code never
 *    filters by org_id for *security*; it may still do so for clarity.
 *  - Cross-table references inside a tenant use composite foreign keys
 *    `(org_id, x_id) -> x(org_id, id)`. FK checks bypass RLS, so without this a
 *    buggy write could attach org A's booking to org B's staff member.
 *  - Timestamps are `timestamptz`; wall-clock business rules are `time` +
 *    the organization's IANA time zone.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Auth (managed by Better Auth). Global, not tenant-scoped.
// ---------------------------------------------------------------------------

export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "staff"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    timeZone: text("time_zone").notNull(),
    currency: text("currency").notNull().default("usd"),
    plan: planEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Booking policy
    slotIntervalMinutes: smallint("slot_interval_minutes").notNull().default(15),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(60),
    maxAdvanceDays: smallint("max_advance_days").notNull().default(60),
    holdMinutes: smallint("hold_minutes").notNull().default(15),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("organizations_slug_key").on(t.slug),
    check("organizations_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'`),
    check("organizations_slot_interval", sql`${t.slotIntervalMinutes} between 5 and 240`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("memberships_org_user_key").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull(),
    /** SHA-256 of the token; the raw token only ever exists in the email. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => authUsers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    check("invitations_role_not_owner", sql`${t.role} <> 'owner'`),
  ],
);

// ---------------------------------------------------------------------------
// Catalog & schedules
// ---------------------------------------------------------------------------

export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Optional link to a login. Staff can exist without an account (e.g. a chair at a salon). */
    userId: text("user_id").references(() => authUsers.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    email: text("email"),
    color: text("color").notNull().default("#6366f1"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("staff_members_org_id_key").on(t.orgId, t.id), uniqueIndex("staff_members_org_user_key").on(t.orgId, t.userId)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: smallint("duration_minutes").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    bufferBeforeMinutes: smallint("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: smallint("buffer_after_minutes").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("services_org_id_key").on(t.orgId, t.id),
    check("services_duration", sql`${t.durationMinutes} between 5 and 720`),
    check("services_money", sql`${t.priceCents} >= 0 and ${t.depositCents} >= 0 and ${t.depositCents} <= ${t.priceCents}`),
    check("services_buffers", sql`${t.bufferBeforeMinutes} between 0 and 240 and ${t.bufferAfterMinutes} between 0 and 240`),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    orgId: uuid("org_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    serviceId: uuid("service_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.serviceId] }),
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.orgId, t.serviceId], foreignColumns: [services.orgId, services.id] }).onDelete("cascade"),
    index("staff_services_service_idx").on(t.serviceId),
  ],
);

/** ISO weekday 1 (Mon) .. 7 (Sun). Multiple rows per day = split shift. */
export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }).onDelete("cascade"),
    check("working_hours_weekday", sql`${t.weekday} between 1 and 7`),
    // `time` accepts '24:00', so end-of-day windows still satisfy start < end.
    check("working_hours_order", sql`${t.startTime} < ${t.endTime}`),
    index("working_hours_staff_idx").on(t.staffId),
  ],
);

export const breaks = pgTable(
  "breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }).onDelete("cascade"),
    check("breaks_weekday", sql`${t.weekday} between 1 and 7`),
    check("breaks_order", sql`${t.startTime} < ${t.endTime}`),
    index("breaks_staff_idx").on(t.staffId),
  ],
);

/** Custom hours for one date. No rows with `closed = true` -> staff is off. */
export const dateOverrides = pgTable(
  "date_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    date: date("date").notNull(),
    /** Null start/end = closed all day. */
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }).onDelete("cascade"),
    check("date_overrides_shape", sql`(${t.startTime} is null) = (${t.endTime} is null)`),
    index("date_overrides_staff_date_idx").on(t.staffId, t.date),
  ],
);

/** Absolute absences. `staff_id` null = applies to the whole organization. */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }).onDelete("cascade"),
    check("time_off_order", sql`${t.startsAt} < ${t.endsAt}`),
    index("time_off_org_range_idx").on(t.orgId, t.startsAt),
  ],
);

/** Org-wide closed dates (public holidays) in the org's local calendar. */
export const holidays = pgTable(
  "holidays",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date] })],
);

// ---------------------------------------------------------------------------
// Customers & bookings
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Stored lower-cased; unique per organization. */
    email: text("email").notNull(),
    phone: text("phone"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_org_id_key").on(t.orgId, t.id),
    unique("customers_org_email_key").on(t.orgId, t.email),
    check("customers_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

export const bookingStatusEnum = pgEnum("booking_status", ["pending_payment", "confirmed", "cancelled", "expired"]);
export const bookingSourceEnum = pgEnum("booking_source", ["public", "dashboard"]);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    staffId: uuid("staff_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    status: bookingStatusEnum("status").notNull(),
    source: bookingSourceEnum("source").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * The range the staff member is unavailable: appointment plus the service's
     * buffers at booking time. Protected by the `bookings_no_overlap`
     * exclusion constraint (see migration 0001).
     */
    blockedFrom: timestamp("blocked_from", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    priceCents: integer("price_cents").notNull(),
    depositCents: integer("deposit_cents").notNull().default(0),
    /** Pending-payment holds stop blocking the slot after this instant. */
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    customerTimeZone: text("customer_time_zone"),
    notes: text("notes"),
    /** Random token for the customer's manage/confirmation link. */
    accessToken: text("access_token").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("bookings_org_id_key").on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staffMembers.orgId, staffMembers.id] }),
    foreignKey({ columns: [t.orgId, t.serviceId], foreignColumns: [services.orgId, services.id] }),
    foreignKey({ columns: [t.orgId, t.customerId], foreignColumns: [customers.orgId, customers.id] }),
    check("bookings_order", sql`${t.startsAt} < ${t.endsAt}`),
    check("bookings_blocked_covers", sql`${t.blockedFrom} <= ${t.startsAt} and ${t.blockedUntil} >= ${t.endsAt}`),
    check("bookings_hold", sql`${t.status} <> 'pending_payment' or ${t.holdExpiresAt} is not null`),
    index("bookings_org_starts_idx").on(t.orgId, t.startsAt),
    index("bookings_customer_idx").on(t.customerId),
    uniqueIndex("bookings_access_token_key").on(t.accessToken),
  ],
);

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").notNull(),
    provider: text("provider").notNull(),
    /** Checkout session id at the provider. */
    externalId: text("external_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.bookingId], foreignColumns: [bookings.orgId, bookings.id] }).onDelete("cascade"),
    uniqueIndex("payments_provider_external_key").on(t.provider, t.externalId),
    index("payments_booking_idx").on(t.bookingId),
  ],
);

// ---------------------------------------------------------------------------
// Infrastructure tables
// ---------------------------------------------------------------------------

/**
 * Inbox / idempotency ledger for provider webhooks. The primary key makes
 * "have we processed this event?" an atomic INSERT ... ON CONFLICT DO NOTHING
 * inside the same transaction as the side effects.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    orgId: uuid("org_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processing", "done", "dead"]);

/**
 * Transactional outbox. Rows are written in the same transaction as the
 * business change; a worker delivers them at-least-once.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    /** Deduplicates logically identical messages, e.g. `reminder:<bookingId>`. */
    dedupeKey: text("dedupe_key"),
    status: outboxStatusEnum("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(8),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("outbox_dedupe_key").on(t.orgId, t.dedupeKey),
    index("outbox_ready_idx").on(t.availableAt).where(sql`${t.status} in ('pending', 'processing')`),
  ],
);

/** Append-only (the app role has no UPDATE/DELETE grant on it). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: inet("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.orgId, t.createdAt)],
);

/** Fixed-window counters for rate limiting, shared by every app instance. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type StaffMember = typeof staffMembers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
export type OutboxMessage = typeof outbox.$inferSelect;
