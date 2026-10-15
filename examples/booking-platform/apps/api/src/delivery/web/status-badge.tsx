import type { BookingStatus } from "@example/bookings/contract";
import { Badge } from "./components/ui/badge.js";

type Props = Readonly<{ status: BookingStatus }>;

export function StatusBadge({ status }: Props) {
  return status === "active" ? <Badge>Active</Badge> : <Badge variant="secondary">Cancelled</Badge>;
}
