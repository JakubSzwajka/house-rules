import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { HttpClient, HttpClientError } from "effect/http";
import { endpoint, type HttpFailureOf, toHttpClient } from "../index.ts";
import { findBookings, renameGuest, showBooking } from "./delivery-fixtures.ts";

const client = toHttpClient([
  endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found"] }),
  endpoint(findBookings, "GET /bookings"),
  endpoint(renameGuest, "PATCH /bookings/:id"),
]);

type ShowFailure = HttpFailureOf<"not_found" | "Unknown">;

const typeChecks = () => [
  // The success, failure and service types come from the contract.
  client.show_booking({ id: "b-1" }) satisfies Effect.Effect<
    {
      readonly id: string;
      readonly owner: string;
      readonly guestName: string;
      readonly nights: number;
    },
    ShowFailure | HttpClientError.HttpClientError,
    HttpClient.HttpClient
  >,
  // @ts-expect-error id is a string in the contract.
  client.show_booking({ id: 1 }),
  // @ts-expect-error show_booking takes no guest field.
  client.show_booking({ id: "b-1", guest: "Ada" }),
  // @ts-expect-error a Union input needs a member's fields: nights wants minNights.
  client.find_bookings({ by: "nights", guest: "Ada" }),
  // An endpoint that declares no code can only fail with Unknown.
  client.find_bookings({ by: "guest", guest: "Ada" }) satisfies Effect.Effect<
    unknown,
    HttpFailureOf<"Unknown"> | HttpClientError.HttpClientError,
    HttpClient.HttpClient
  >,
  // @ts-expect-error rename_guest needs guestName.
  client.rename_guest({ id: "b-1" }),
  // @ts-expect-error no endpoint is called delete_booking.
  client.delete_booking,
  client.show_booking({ id: "b-1" }).pipe(
    // @ts-expect-error a booking has no price.
    Effect.map((booking) => booking.price),
  ),
  client.show_booking({ id: "b-1" }).pipe(
    Effect.catchTag("HttpFailure", (failure) =>
      Effect.succeed(
        // @ts-expect-error forbidden is no code the endpoint declares, so the codes cannot overlap.
        failure.code === "forbidden",
      ),
    ),
  ),
];

it("the client's types come from the contracts", () => {
  expect(typeof typeChecks).toBe("function");
});
