import { afterAll, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { api } from "../main.js";
import { app } from "../server/composition.js";

afterAll(() => api.dispose().then(app.dispose));

const get = (path: string, headers: Record<string, string> = {}) =>
  Effect.promise(() =>
    api(new Request(`https://hosti.example${path}`, { headers }) as Request),
  ).pipe(
    Effect.flatMap((response) =>
      Effect.promise((): Promise<unknown> => response.json()).pipe(
        Effect.map((body) => ({ status: response.status, headers: response.headers, body })),
      ),
    ),
  );

it.effect("GET /api/bookings/:id maps BookingNotFound through the app's view", () =>
  Effect.gen(function* notFound() {
    const r = yield* get("/api/bookings/missing", { "x-request-id": "req-1" });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({
      error: { code: "not_found", message: "Booking missing was not found." },
    });
    expect(r.headers.get("x-request-id")).toBe("req-1");
  }),
);

it.effect("an unknown query key is a 400 that names it", () =>
  Effect.gen(function* unknownKey() {
    const r = yield* get("/api/bookings/b-1?admin=true");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: "invalid_input", field: "admin" } });
  }),
);
