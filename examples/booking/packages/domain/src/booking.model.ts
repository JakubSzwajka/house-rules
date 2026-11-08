import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";
import { Booking } from "./booking/booking.aggregate.ts";
import { MyBookings } from "./my-bookings.view.ts";
import { BookingPayment, BookingPaymentLive } from "./payment/booking-payment.policy.ts";
import { Payment } from "./payment/payment.aggregate.ts";
import { PaymentSettlement, PaymentSettlementLive } from "./payment/payment-settlement.policy.ts";

export class BookingModel extends Domain.Model("Bookings", {
  aggregates: [Booking, Payment],
  views: [MyBookings],
  policies: [BookingPayment, PaymentSettlement],
}) {}

export const BookingHandlers = Layer.mergeAll(BookingPaymentLive, PaymentSettlementLive);
