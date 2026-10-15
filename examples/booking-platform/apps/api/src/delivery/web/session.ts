import { type CallEntry, HttpFailure, toPromiseClient } from "@house-rules/application/contract";
import { Schema } from "effect";
import { api, publicApi } from "../http/api.js";

const isFailure = Schema.is(HttpFailure);

export const clientsFor = (onSettled: (entry: CallEntry) => void) => ({
  accounts: toPromiseClient(publicApi, { onCall: onSettled }),
  member: toPromiseClient(api, { onCall: onSettled }),
});

export type Clients = ReturnType<typeof clientsFor>;
export type Member = Clients["member"];

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const clockAt = (epochMillis: number): string => clockFormat.format(epochMillis);

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const stampAt = (epochMillis: number): string => stampFormat.format(epochMillis);

const messageOf = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body;
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  return String(error.message);
};

export type Problem = Readonly<{ code: string; message: string }>;

export const problemOf = (error: unknown): Problem => {
  if (!isFailure(error)) return { code: "network", message: String(error) };
  return {
    code: `${error.status} ${error.code}`,
    message: messageOf(error.body) ?? "No answer.",
  };
};

export const newBookingId = (): string => {
  // Not crypto.randomUUID(): the Effect diagnostic bans it, and this page runs no Effect.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `b-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
