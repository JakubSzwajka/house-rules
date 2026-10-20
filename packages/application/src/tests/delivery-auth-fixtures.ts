import { Actor, ActorId } from "@house-rules/domain";
import { Effect } from "effect";
import { Refused, type Incoming, type WhoSocket } from "../index.ts";
import type { Bookings, Work } from "./delivery-bookings-fixtures.ts";

export const metadataUrl = "https://app.example/.well-known/oauth-protected-resource/mcp";
const cookieOf = (incoming: Incoming, name: string) =>
  (incoming.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
export const sessionWhoFor = (work: Work): WhoSocket<Bookings> => ({
  resolve: (incoming) =>
    Effect.gen(function* () {
      work.callers += 1;
      if (cookieOf(incoming, "session") !== "s-ada")
        return yield* new Refused({
          status: 401,
          code: "session_invalid",
          message: "Sign in again.",
        });
      return Actor.make({ id: ActorId.make("ada") });
    }),
});
export const bearerWhoFor = (work: Work, readOnly = false): WhoSocket<Bookings> => ({
  resolve: (incoming) =>
    Effect.gen(function* () {
      work.callers += 1;
      const token = /^Bearer\s+(\S+)$/iu.exec(incoming.headers.get("authorization") ?? "")?.[1];
      if (token === "tok-ada-read" && !readOnly)
        return yield* new Refused({
          status: 403,
          code: "forbidden",
          message: "A read token cannot use this way.",
        });
      if (token !== "tok-ada" && !(readOnly && token === "tok-ada-read"))
        return yield* new Refused({
          status: 401,
          code: token === undefined ? "token_missing" : "token_invalid",
          message: "Send a valid token as Authorization: Bearer <token>.",
          challenge: `Bearer resource_metadata="${metadataUrl}"`,
        });
      return Actor.make({ id: ActorId.make("ada") });
    }),
});
