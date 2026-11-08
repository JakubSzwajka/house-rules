import * as Domain from "@alchemy.run/domain";
import { Forbidden, PersonId, Session } from "@house-rules/stack";
import * as Schema from "effect/Schema";
import { BookingId } from "../booking/booking.id.ts";

export class PaymentPaid extends Domain.Event("PaymentPaid", {
  owner: PersonId,
  chargeId: Schema.String,
}) {}

export class RecordCharge extends Domain.Command("RecordCharge", {
  target: BookingId,
  middleware: [Session],
  input: { chargeId: Schema.String },
  events: [PaymentPaid],
  rejects: [Forbidden],
}) {}
