import { type CallEntry, HttpFailure, toPromiseClient } from "@house-rules/application/contract";
import { Schema } from "effect";
import { api, devApi } from "../http/api.js";

export type LoggedCall = CallEntry & Readonly<{ at: string; key: number }>;

export const clientsFor = (
  token: () => string | undefined,
  onCall: (entry: CallEntry) => void,
) => ({
  dev: toPromiseClient(devApi, { onCall }),
  member: toPromiseClient(api, { token, onCall }),
});

export type Clients = ReturnType<typeof clientsFor>;
export type Member = Clients["member"];

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const clockNow = (): string =>
  clockFormat.format(performance.timeOrigin + performance.now());

const isFailure = Schema.is(HttpFailure);

const messageOf = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body;
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  return String(error.message);
};

export const problemOf = (error: unknown): string => {
  if (!isFailure(error)) return String(error);
  const message = messageOf(error.body) ?? "No answer.";
  return `${error.status} ${error.code}: ${message}`;
};
