import { Story } from "@alchemy.run/domain/Story";
import { person } from "@house-rules/stack";
import { Booking } from "../booking/booking.aggregate.ts";
import { BookingId } from "../booking/booking.id.ts";
import { BookingHandlers, BookingModel } from "../booking.model.ts";
import { Payment } from "../payment/payment.aggregate.ts";
import { PaymentProvider } from "../payment/payment-provider.external.ts";
import { BookingRoles } from "../roles.ts";

export const story = Story.make(BookingModel, { layer: BookingHandlers, stub: [PaymentProvider] });

export const ann = person("ann", { roles: ["member"], permissions: BookingRoles.member });
export const annAtAcme = person("ann", {
  roles: ["member"],
  permissions: BookingRoles.member,
  orgId: "acme",
});
export const carol = person("carol", { roles: ["member"], permissions: BookingRoles.member });
export const dave = person("dave", {
  roles: ["org-admin"],
  permissions: BookingRoles["org-admin"],
  orgId: "acme",
});
export const guest = person("gus", { roles: ["guest"] });

export const b1 = BookingId.make("b-1");
export const booking1 = Booking.ref(b1);
export const payment1 = Payment.ref(b1);
