import type { ActorId } from "@house-rules/domain";
import { Effect, Layer, Redacted, Schema } from "effect";
import { SessionControl } from "../../sessions/session-control.js";
import { SessionControlUnavailable, SessionsPartlyEnded } from "../../sessions/sessions.js";
import { BindingStore } from "../../storage.js";

export type ClerkSessionsOptions = Readonly<{
  issuer: string;
  secretKey: Redacted.Redacted<string>;
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
}>;
const Session = Schema.Struct({ id: Schema.NonEmptyString });
const Page = Schema.Union([Schema.Array(Session), Schema.Struct({ data: Schema.Array(Session) })]);
const decode = Schema.decodeUnknownEffect(Page);

export const clerkSessionControl = (options: ClerkSessionsOptions) =>
  Layer.effect(
    SessionControl,
    Effect.gen(function* () {
      const store = yield* BindingStore;
      const fetch = options.fetch ?? globalThis.fetch;
      const request = (path: string, method: "GET" | "POST") =>
        Effect.tryPromise({
          try: (signal) =>
            fetch(`https://api.clerk.com/v1${path}`, {
              method,
              signal,
              headers: { authorization: `Bearer ${Redacted.value(options.secretKey)}` },
            }),
          catch: () => new SessionControlUnavailable(),
        });
      const list = Effect.fnUntraced(function* (users: ReadonlyArray<string>) {
        const ids = new Set<string>();
        for (const user of users) {
          for (let offset = 0; ; offset += 500) {
            const response = yield* request(
              `/sessions?user_id=${encodeURIComponent(user)}&status=active&limit=500&offset=${offset}`,
              "GET",
            );
            if (!response.ok) return yield* new SessionControlUnavailable();
            const raw = yield* Effect.tryPromise({
              try: () => response.json(),
              catch: () => new SessionControlUnavailable(),
            });
            const page = yield* decode(raw).pipe(
              Effect.mapError(() => new SessionControlUnavailable()),
            );
            const sessions = "data" in page ? page.data : page;
            for (const session of sessions) ids.add(session.id);
            if (sessions.length < 500) break;
          }
        }
        return [...ids];
      });
      return SessionControl.of({
        endAll: Effect.fnUntraced(function* (actorId: ActorId) {
          const bindings = yield* store
            .list(actorId)
            .pipe(Effect.mapError(() => new SessionControlUnavailable()));
          const users = [
            ...new Set(
              bindings
                .filter((binding) => binding.issuer === options.issuer)
                .map((binding) => binding.subject),
            ),
          ];
          let ids = yield* list(users);
          let ended = 0;
          for (let round = 0; round < 3 && ids.length > 0; round++) {
            // Snapshot every page before revocation can change the active-session offsets.
            let pending = ids.length;
            for (const id of ids) {
              const response = yield* request(
                `/sessions/${encodeURIComponent(id)}/revoke`,
                "POST",
              ).pipe(Effect.mapError(() => new SessionsPartlyEnded({ ended, remaining: pending })));
              if (response.ok) ended++;
              else if (response.status !== 404)
                return yield* new SessionsPartlyEnded({ ended, remaining: pending });
              pending--;
            }
            ids = yield* list(users).pipe(
              Effect.mapError(() => new SessionsPartlyEnded({ ended, remaining: pending })),
            );
          }
          if (ids.length > 0)
            return yield* new SessionsPartlyEnded({ ended, remaining: ids.length });
          return { ended };
        }),
      });
    }),
  );
