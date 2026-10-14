import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "@/db/schema";

const MAP: Record<
  BookingStatus,
  { label: string; variant: "success" | "warning" | "muted" | "destructive" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending_payment: { label: "Awaiting deposit", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  expired: { label: "Expired", variant: "muted" },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { label, variant } = MAP[status];
  return <Badge variant={variant}>{label}</Badge>;
}
