import * as Domain from "@alchemy.run/domain";
import { BookingModel } from "./booking.model.ts";

export class BookingApi extends Domain.Api("BookingApi", {
  model: BookingModel,
  commands: ["MakeBooking", "CancelBooking"],
  views: ["MyBookings"],
  aggregates: [],
  streams: [],
}) {}
