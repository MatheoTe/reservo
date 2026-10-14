import { z } from "zod";

/**
 * zod schemas shared by forms (client) and server actions / route handlers.
 * The server never trusts client validation; it re-parses every input.
 */

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(48, "At most 48 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/, "Lowercase letters, numbers and dashes only");

export const RESERVED_SLUGS = new Set(["app", "api", "admin", "b", "sign-in", "sign-up", "invite", "onboarding", "www"]);

export const timeZoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

export const isoDateSchema = z.iso.date();
export const wallTimeSchema = z.string().regex(WALL_TIME, "Use HH:MM");
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email"));

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  slug: slugSchema.refine((s) => !RESERVED_SLUGS.has(s), "This URL is reserved"),
  timeZone: timeZoneSchema,
  currency: z.enum(["usd", "eur", "ars", "gbp", "mxn"]).default("usd"),
});

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timeZone: timeZoneSchema,
  slotIntervalMinutes: z.coerce.number().int().min(5).max(240),
  minNoticeMinutes: z.coerce.number().int().min(0).max(60 * 24 * 14),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
});

const minutes = (max: number) => z.coerce.number().int().min(0).max(max);

export const serviceSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(80),
    description: z.string().trim().max(500).optional().transform((v) => v || null),
    durationMinutes: z.coerce.number().int().min(5, "At least 5 minutes").max(720),
    priceCents: z.coerce.number().int().min(0).max(10_000_000),
    depositCents: z.coerce.number().int().min(0).max(10_000_000),
    bufferBeforeMinutes: minutes(240),
    bufferAfterMinutes: minutes(240),
    staffIds: z.array(z.uuid()).default([]),
  })
  .refine((s) => s.depositCents <= s.priceCents, { path: ["depositCents"], message: "Deposit can't exceed the price" });

export const weeklyWindowSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    start: wallTimeSchema,
    end: wallTimeSchema,
  })
  .refine((w) => w.start < w.end, { message: "End must be after start", path: ["end"] });

export const scheduleSchema = z.object({
  staffId: z.uuid(),
  hours: z.array(weeklyWindowSchema).max(50),
  breaks: z.array(weeklyWindowSchema).max(50),
});

export const timeOffSchema = z
  .object({
    staffId: z.uuid().nullable(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((t) => t.startsAt < t.endsAt, { message: "End must be after start", path: ["endsAt"] });

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["admin", "staff"]),
});

export const changeRoleSchema = z.object({
  membershipId: z.uuid(),
  role: z.enum(["owner", "admin", "staff"]),
});

export const customerDetailsSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(120),
  email: emailSchema,
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d\s().-]*$/, "Digits, spaces and + ( ) - only")
    .optional()
    .transform((v) => v || null),
});

export const publicBookingSchema = z.object({
  serviceId: z.uuid(),
  /** `null` = any available staff member. */
  staffId: z.uuid().nullable(),
  start: z.iso.datetime({ offset: true }),
  customer: customerDetailsSchema,
  customerTimeZone: timeZoneSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Honeypot: humans never fill it. */
  website: z.string().max(0).optional(),
});

export const availabilityQuerySchema = z
  .object({
    serviceId: z.uuid(),
    staffId: z.uuid().optional(),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((q) => q.from <= q.to, { message: "`from` must not be after `to`", path: ["to"] });

/** Staff enter wall-clock date + time; the server interprets it in the org's zone. */
export const dashboardBookingSchema = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  date: isoDateSchema,
  time: wallTimeSchema,
  customer: customerDetailsSchema,
  notes: z.string().trim().max(1000).optional(),
});

export const cancelBookingSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().max(300).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type ServiceInput = z.infer<typeof serviceSchema>;
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
