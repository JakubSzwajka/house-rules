import { Clock, DateTime, Effect, Logger } from "effect";
import type { CallNotes } from "../../composition/request-log.js";

type Handler = (request: Request) => Promise<Response>;

export type AccessLine = Readonly<{
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string | null;
  capability: string | null;
  outcome: string | null;
  actor: string | null;
}>;

export const formatAccessLine = (line: AccessLine, clock: string): string =>
  [
    clock,
    line.method.padEnd(4),
    line.path,
    String(line.status),
    `${line.ms}ms`,
    line.capability === null ? "-" : `${line.capability}:${line.outcome ?? "?"}`,
    `actor=${line.actor ?? "-"}`,
    `req=${line.requestId?.slice(0, 8) ?? "-"}`,
  ].join(" ");

export const accessLogger = Logger.withConsoleLog(
  Logger.make(({ message }) => (Array.isArray(message) ? message.join(" ") : String(message))),
);

export const logRequests =
  (handler: Handler, notes: CallNotes) =>
  (request: Request): Effect.Effect<Response> =>
    Effect.gen(function* accessLog() {
      const started = yield* Clock.currentTimeMillis;
      const response = yield* Effect.promise(() => handler(request));
      const ms = (yield* Clock.currentTimeMillis) - started;
      // The adapter echoes the request id, so the CallWatch's note joins on it.
      const requestId = response.headers.get("x-request-id");
      const note = requestId === null ? undefined : notes.take(requestId);
      const clock = DateTime.formatLocal(yield* DateTime.now, {
        locale: "en-GB",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
      yield* Effect.logInfo(
        formatAccessLine(
          {
            method: request.method,
            path: new URL(request.url).pathname,
            status: response.status,
            ms,
            requestId,
            capability: note?.capability ?? null,
            outcome: note?.outcome ?? null,
            actor: note?.actor ?? null,
          },
          clock,
        ),
      );
      return response;
    }).pipe(Effect.provideService(Logger.CurrentLoggers, new Set([accessLogger])));
