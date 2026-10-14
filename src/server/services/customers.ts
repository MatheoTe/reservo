import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { bookings, customers, services } from "@/db/schema";

import type { Tx } from "../db/client";
import { notFound } from "../errors";

export async function listCustomers(tx: Tx, opts: { search?: string; limit?: number } = {}) {
  const term = opts.search?.trim();
  return tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      createdAt: customers.createdAt,
      bookingCount: sql<number>`(select count(*)::int from ${bookings} b where b.customer_id = ${customers.id} and b.status = 'confirmed')`,
      lastVisit: sql<Date | null>`(select max(b.starts_at) from ${bookings} b where b.customer_id = ${customers.id} and b.status = 'confirmed')`,
    })
    .from(customers)
    .where(term ? or(ilike(customers.name, `%${term}%`), ilike(customers.email, `%${term}%`)) : undefined)
    .orderBy(customers.name)
    .limit(opts.limit ?? 200);
}

export async function getCustomer(tx: Tx, customerId: string) {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) throw notFound("Customer");
  const history = await tx
    .select({ id: bookings.id, startsAt: bookings.startsAt, status: bookings.status, serviceName: services.name, priceCents: bookings.priceCents })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .where(and(eq(bookings.customerId, customerId)))
    .orderBy(desc(bookings.startsAt))
    .limit(50);
  return { customer, history };
}

export async function updateCustomerNotes(tx: Tx, customerId: string, notes: string) {
  const [row] = await tx.update(customers).set({ notes }).where(eq(customers.id, customerId)).returning({ id: customers.id });
  if (!row) throw notFound("Customer");
}
