import { and, count, desc, eq, ilike, lte, max, or, sql } from "drizzle-orm";

import { bookings, customers, services } from "@/db/schema";

import type { Tx } from "../db/client";
import { notFound } from "../errors";

/**
 * A visit is a confirmed booking that has already started. Aggregated once in a
 * derived table and joined by customer: a correlated subquery written with raw
 * `sql` loses the outer table qualifier and silently compares the booking with
 * itself, which is how every customer used to show 0 visits.
 */
export async function listCustomers(tx: Tx, opts: { search?: string; limit?: number } = {}) {
  const term = opts.search?.trim();
  const visits = tx
    .select({
      customerId: bookings.customerId,
      visits: count().as("visits"),
      lastVisit: max(bookings.startsAt).as("last_visit"),
    })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), lte(bookings.startsAt, sql`now()`)))
    .groupBy(bookings.customerId)
    .as("visits");
  return tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      createdAt: customers.createdAt,
      visits: sql<number>`coalesce(${visits.visits}, 0)`.mapWith(Number),
      lastVisit: visits.lastVisit,
    })
    .from(customers)
    .leftJoin(visits, eq(visits.customerId, customers.id))
    .where(
      term
        ? or(ilike(customers.name, `%${term}%`), ilike(customers.email, `%${term}%`))
        : undefined,
    )
    .orderBy(customers.name)
    .limit(opts.limit ?? 200);
}

export async function getCustomer(tx: Tx, customerId: string) {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
  if (!customer) throw notFound("Customer");
  const history = await tx
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      status: bookings.status,
      serviceName: services.name,
      priceCents: bookings.priceCents,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .where(and(eq(bookings.customerId, customerId)))
    .orderBy(desc(bookings.startsAt))
    .limit(50);
  return { customer, history };
}

export async function updateCustomerNotes(tx: Tx, customerId: string, notes: string) {
  const [row] = await tx
    .update(customers)
    .set({ notes })
    .where(eq(customers.id, customerId))
    .returning({ id: customers.id });
  if (!row) throw notFound("Customer");
}
