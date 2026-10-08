import { BookingPermissions, Bookings } from "@hosti/bookings";
import { Grant } from "@house-rules/capability";
import { Layer } from "effect";

export const visitorGrant: Layer.Layer<Grant> = Grant.layerFromPermissions([
  BookingPermissions.read,
]);

export const appLayer: Layer.Layer<Bookings | Grant> = Layer.mergeAll(
  Bookings.fromRecords([]),
  visitorGrant,
);
