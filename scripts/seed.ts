/**
 * Demo data: two fictional businesses with staff, services, schedules,
 * customers and a few weeks of bookings. Everything goes through the real
 * services (and therefore through RLS and the availability engine), so the
 * seed doubles as a smoke test of the write path.
 *
 *   npm run seed            # once, on a migrated database
 *   npm run db:reset && npm run seed   # start over
 */
import "./load-env";

import { eq } from "drizzle-orm";
import postgres from "postgres";
import { Temporal } from "temporal-polyfill";

import {
  breaks,
  holidays,
  memberships,
  organizations,
  services,
  staffMembers,
  staffServices,
  workingHours,
} from "@/db/schema";
import { computeSlots } from "@/lib/availability";
import { getAuth } from "@/server/auth/auth";
import { closeDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { AppError } from "@/server/errors";
import { loadAvailabilityQuery } from "@/server/services/availability";
import { loadOrg, reserveSlot } from "@/server/services/bookings";
import { createOrganization } from "@/server/services/organizations";

const PASSWORD = "reservo-demo-2026";

// Small deterministic PRNG so every seed run produces the same calendar.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261014);
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

const FIRST = ["Ana", "Bruno", "Camila", "Diego", "Elena", "Facundo", "Gala", "Hugo", "Inés", "Joaquín", "Karen", "Lautaro", "Martina", "Nicolás", "Olivia", "Pablo", "Renata", "Santiago", "Tamara", "Uriel", "Valeria", "Walter", "Ximena", "Yamila", "Zoe"];
const LAST = ["Acosta", "Benítez", "Castro", "Domínguez", "Espósito", "Fernández", "Giménez", "Herrera", "Ibarra", "Juárez", "Kovac", "López", "Medina", "Navarro", "Ortiz", "Peralta", "Quiroga", "Romero", "Sosa", "Torres"];

const customers = Array.from({ length: 28 }, (_, i) => {
  const first = FIRST[i % FIRST.length]!;
  const last = pick(LAST);
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "") + `${i}@example.com`,
    phone: random() > 0.4 ? `+54 9 11 ${String(Math.floor(1000 + random() * 8999))}-${String(Math.floor(1000 + random() * 8999))}` : null,
  };
});

async function createUser(name: string, email: string) {
  const res = await getAuth().api.signUpEmail({ body: { name, email, password: PASSWORD } });
  return { id: res.user.id, name, email };
}

type Hours = { weekday: number; start: string; end: string }[];
const days = (list: number[], start: string, end: string): Hours => list.map((weekday) => ({ weekday, start, end }));

interface OrgSpec {
  name: string;
  slug: string;
  timeZone: string;
  currency: "usd" | "eur" | "ars";
  owner: { name: string; email: string; color: string; hours: Hours; breaks: Hours };
  admin?: { name: string; email: string };
  staff: { name: string; color: string; hours: Hours; breaks: Hours }[];
  services: { name: string; description: string; durationMinutes: number; priceCents: number; depositCents?: number; bufferAfterMinutes?: number; staff: "all" | number[] }[];
  bookingsPerDay: number;
}

const SPECS: OrgSpec[] = [
  {
    name: "Glow Studio",
    slug: "glow-studio",
    timeZone: "America/Argentina/Buenos_Aires",
    currency: "usd",
    owner: { name: "Lucía Fernández", email: "demo@reservo.dev", color: "#8b5cf6", hours: days([2, 3, 4, 5, 6], "10:00", "19:00"), breaks: days([2, 3, 4, 5, 6], "14:00", "15:00") },
    admin: { name: "Valentina Ríos", email: "admin@reservo.dev" },
    staff: [
      { name: "Mateo Sosa", color: "#0ea5e9", hours: days([2, 3, 4, 5, 6], "11:00", "20:00"), breaks: days([2, 3, 4, 5, 6], "15:00", "15:30") },
      { name: "Sofía Medina", color: "#f43f5e", hours: days([1, 2, 3, 4, 5], "09:00", "17:00"), breaks: days([1, 2, 3, 4, 5], "13:00", "13:45") },
    ],
    services: [
      { name: "Haircut & Style", description: "Consultation, wash, precision cut and blow-dry.", durationMinutes: 45, priceCents: 4500, staff: [0, 1] },
      { name: "Color & Gloss", description: "Single-process color with a glossing treatment. A deposit secures your chair.", durationMinutes: 120, priceCents: 14000, depositCents: 3000, bufferAfterMinutes: 15, staff: [0] },
      { name: "Beard Trim", description: "Shape-up, hot towel and finishing oil.", durationMinutes: 30, priceCents: 2500, staff: [1] },
      { name: "Gel Manicure", description: "Cuticle care, shaping and long-lasting gel polish.", durationMinutes: 60, priceCents: 3500, bufferAfterMinutes: 10, staff: [2] },
    ],
    bookingsPerDay: 5,
  },
  {
    name: "Northside Physio",
    slug: "northside-physio",
    timeZone: "Europe/Madrid",
    currency: "eur",
    owner: { name: "Daniel Ortiz", email: "physio@reservo.dev", color: "#10b981", hours: days([1, 2, 3, 4, 5], "08:00", "16:00"), breaks: [] },
    staff: [{ name: "Irene Castro", color: "#f59e0b", hours: days([1, 3, 5], "12:00", "20:00"), breaks: [] }],
    services: [
      { name: "Initial Assessment", description: "60-minute evaluation and treatment plan.", durationMinutes: 60, priceCents: 6500, bufferAfterMinutes: 10, staff: "all" },
      { name: "Follow-up Session", description: "Manual therapy and guided exercise.", durationMinutes: 40, priceCents: 4500, bufferAfterMinutes: 5, staff: "all" },
    ],
    bookingsPerDay: 3,
  },
];

async function seedOrg(spec: OrgSpec) {
  const owner = await createUser(spec.owner.name, spec.owner.email);
  const { id: orgId } = await createOrganization(owner, { name: spec.name, slug: spec.slug, timeZone: spec.timeZone, currency: spec.currency });
  const admin = spec.admin ? await createUser(spec.admin.name, spec.admin.email) : null;

  await withTenant({ orgId, userId: owner.id }, async (tx) => {
    await tx.update(organizations).set({ minNoticeMinutes: 120, slotIntervalMinutes: 15 }).where(eq(organizations.id, orgId));
    const [ownerStaff] = await tx.select().from(staffMembers).where(eq(staffMembers.userId, owner.id));
    await tx.update(staffMembers).set({ color: spec.owner.color }).where(eq(staffMembers.id, ownerStaff!.id));
    if (admin) await tx.insert(memberships).values({ orgId, userId: admin.id, role: "admin" });

    const ids = [ownerStaff!.id];
    for (const s of spec.staff) {
      const [row] = await tx.insert(staffMembers).values({ orgId, displayName: s.name, color: s.color }).returning();
      ids.push(row!.id);
    }
    const schedules = [spec.owner, ...spec.staff];
    for (const [i, staffId] of ids.entries()) {
      await tx.delete(workingHours).where(eq(workingHours.staffId, staffId));
      const sch = schedules[i]!;
      if (sch.hours.length) await tx.insert(workingHours).values(sch.hours.map((h) => ({ orgId, staffId, weekday: h.weekday, startTime: h.start, endTime: h.end })));
      if (sch.breaks.length) await tx.insert(breaks).values(sch.breaks.map((h) => ({ orgId, staffId, weekday: h.weekday, startTime: h.start, endTime: h.end })));
    }
    for (const svc of spec.services) {
      const [row] = await tx
        .insert(services)
        .values({ orgId, name: svc.name, description: svc.description, durationMinutes: svc.durationMinutes, priceCents: svc.priceCents, depositCents: svc.depositCents ?? 0, bufferAfterMinutes: svc.bufferAfterMinutes ?? 0 })
        .returning();
      const performers = svc.staff === "all" ? ids : svc.staff.map((i) => ids[i]!);
      await tx.insert(staffServices).values(performers.map((staffId) => ({ orgId, staffId, serviceId: row!.id })));
    }
    const year = Temporal.Now.plainDateISO(spec.timeZone).year;
    await tx.insert(holidays).values({ orgId, date: `${year}-12-25`, name: "Christmas Day" }).onConflictDoNothing();
  });

  // Bookings: three weeks back, two weeks ahead, placed only where the engine says it's free.
  const today = Temporal.Now.plainDateISO(spec.timeZone);
  let created = 0;
  for (let d = -21; d <= 14; d++) {
    const date = today.add({ days: d }).toString();
    for (let n = 0; n < spec.bookingsPerDay; n++) {
      await withTenant({ orgId, userId: owner.id }, async (tx) => {
        const org = await loadOrg(tx, orgId);
        const serviceRows = await tx.select().from(services);
        const service = pick(serviceRows);
        const links = await tx.select().from(staffServices).where(eq(staffServices.serviceId, service.id));
        const staffId = pick(links).staffId;
        // Pretend "now" is the day before, so past days are bookable in the seed.
        const now = new Date(Temporal.PlainDate.from(date).subtract({ days: 1 }).toZonedDateTime(org.timeZone).epochMilliseconds);
        const query = await loadAvailabilityQuery(tx, { org, service, staffIds: [staffId], from: date, to: date, now });
        const slots = computeSlots(query);
        if (slots.length === 0) return;
        const slot = pick(slots);
        await reserveSlot(tx, {
          org,
          serviceId: service.id,
          staffId,
          start: new Date(slot.start),
          customer: pick(customers),
          // Deposit services booked in the past would be stale holds; treat them as walk-ins.
          source: service.depositCents > 0 || random() < 0.25 ? "dashboard" : "public",
          now,
        });
        created++;
      }).catch((err: unknown) => {
        // A random pick can collide with an earlier one; that's the constraint doing its job.
        if (!(err instanceof AppError && err.code === "SLOT_UNAVAILABLE")) throw err;
      });
    }
  }
  return { orgId, created };
}

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is not set");
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    const existing = await admin`select 1 from auth_users where email = 'demo@reservo.dev'`;
    if (existing.length > 0) {
      console.log("Demo data already present. Run `npm run db:reset && npm run seed` to start over.");
      return;
    }
    for (const spec of SPECS) {
      const { created } = await seedOrg(spec);
      console.log(`Seeded ${spec.name} (/b/${spec.slug}) with ${created} bookings`);
    }
    // Don't email fictional customers about historical bookings on first `npm run dev`.
    await admin`update outbox set status = 'done', processed_at = now(), last_error = 'skipped by seed'`;
    console.log(`\nSign in at http://localhost:3000/sign-in\n  owner: demo@reservo.dev / ${PASSWORD}\n  admin: admin@reservo.dev / ${PASSWORD}`);
  } finally {
    await admin.end();
    await closeDb();
  }
}

await main();
