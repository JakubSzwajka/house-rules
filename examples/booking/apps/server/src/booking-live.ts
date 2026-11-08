import { BookingHandlers, BookingModel } from "@example/booking-domain";
import { type AuthProvider, SessionLive } from "@house-rules/stack";
import * as Layer from "effect/Layer";
import { BookingRolesLive } from "./auth.ts";
import { FakePaymentProvider } from "./fake-payment-provider.ts";

export const bookingLive = <E, R>(auth: Layer.Layer<AuthProvider, E, R>) =>
  SessionLive.pipe(
    Layer.provide(Layer.mergeAll(auth, BookingRolesLive)),
    Layer.provideMerge(BookingModel.layer(BookingHandlers)),
    Layer.provide(FakePaymentProvider),
  );
