import * as Domain from "@alchemy.run/domain";
import { Forbidden, PartyId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";

export class PaymentRefunded extends Domain.Event("PaymentRefunded", {
  owner: PartyId,
  refundId: Schema.String,
}) {}

export class RecordRefund extends Domain.Command("RecordRefund", {
  target: BookingId,
  middleware: [Session],
  input: { refundId: Schema.String },
  events: [PaymentRefunded],
  rejects: [Forbidden],
}) {}
