import { firstSignInWay } from "../../hooks/first-sign-in.ts";
import { assert, it } from "@effect/vitest";
import { toFetchHandler } from "@house-rules/application";
import { Effect } from "effect";
import { createApp } from "../../../composition/app.ts";
import { webWay } from "../way.ts";

it.live(
  "real account cookies, CSRF, generic refusals, password change and A/B booking privacy",
  () =>
    Effect.gen(function* () {
      const app = yield* Effect.acquireRelease(
        Effect.sync(() => createApp([webWay, firstSignInWay])),
        (app) => Effect.promise(() => app.dispose()),
      );
      const router = yield* Effect.acquireRelease(
        Effect.sync(() => toFetchHandler(app)),
        (router) => Effect.promise(() => router.dispose()),
      );
      const post = (name: string, body: unknown, cookie = "", origin = "https://booking.example") =>
        Effect.promise(() =>
          router(
            new Request(`https://booking.example/api/${name}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(origin ? { origin } : {}),
                ...(cookie ? { cookie } : {}),
              },
              body: JSON.stringify(body),
            }),
          ),
        );
      const credentials = {
        email: "alice@example.test",
        password: "correct horse battery",
        displayName: "Alice",
      };
      assert.strictEqual((yield* post("sign_up", credentials, "", "")).status, 403);
      assert.strictEqual(
        (yield* post("sign_up", credentials, "", "https://evil.example")).status,
        403,
      );
      const up = yield* post("sign_up", credentials);
      assert.strictEqual(up.status, 200);
      const cookie = up.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert.include(cookie, "booking_session=");
      assert.include(up.headers.get("set-cookie") ?? "", "HttpOnly");
      assert.notProperty(yield* Effect.promise(() => up.json()), "token");
      assert.strictEqual(
        (yield* post(
          "make_booking",
          { id: "alice-booking", guestName: "Alice", paymentId: "alice-pay", amount: 10 },
          cookie,
        )).status,
        200,
      );
      const bobUp = yield* post("sign_up", {
        ...credentials,
        email: "bob@example.test",
        displayName: "Bob",
      });
      const bobCookie = bobUp.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert.strictEqual(
        (yield* post(
          "make_booking",
          { id: "bob-booking", guestName: "Bob", paymentId: "bob-pay", amount: 10 },
          bobCookie,
        )).status,
        200,
      );
      assert.strictEqual((yield* post("show_booking", { id: "bob-booking" }, cookie)).status, 404);
      assert.strictEqual(
        (yield* post("show_booking", { id: "alice-booking" }, cookie)).status,
        200,
      );
      const bad = yield* post("sign_in", { email: credentials.email, password: "wrong password" });
      const unknown = yield* post("sign_in", {
        email: "unknown@example.test",
        password: "wrong password",
      });
      assert.strictEqual(bad.status, 200);
      assert.strictEqual(unknown.status, 200);
      assert.isNull(bad.headers.get("set-cookie"));
      assert.isNull(unknown.headers.get("set-cookie"));
      assert.deepStrictEqual(yield* Effect.promise(() => bad.json()), {
        _tag: "InvalidCredentials",
      });
      assert.deepStrictEqual(yield* Effect.promise(() => unknown.json()), {
        _tag: "InvalidCredentials",
      });
      assert.strictEqual(
        (yield* post(
          "sign_in",
          { email: credentials.email, password: credentials.password },
          "",
          "",
        )).status,
        403,
      );
      const signed = yield* post("sign_in", {
        email: credentials.email,
        password: credentials.password,
      });
      assert.strictEqual(signed.status, 200);
      assert.include(signed.headers.get("set-cookie") ?? "", "booking_session=");
      assert.strictEqual(
        (yield* post(
          "change_password",
          { current: credentials.password, next: "new correct horse battery" },
          cookie,
        )).status,
        200,
      );
      const old = yield* post("sign_in", {
        email: credentials.email,
        password: credentials.password,
      });
      assert.deepStrictEqual(yield* Effect.promise(() => old.json()), {
        _tag: "InvalidCredentials",
      });
      const next = yield* post("sign_in", {
        email: credentials.email,
        password: "new correct horse battery",
      });
      assert.strictEqual(next.status, 200);
      assert.isNotNull(next.headers.get("set-cookie"));
      assert.strictEqual((yield* post("sign_out", {}, cookie, "")).status, 403);
      const out = yield* post("sign_out", {}, cookie);
      assert.strictEqual(out.status, 200);
      assert.include(out.headers.get("set-cookie") ?? "", "Max-Age=0");
      assert.strictEqual((yield* post("show_booking", { id: "alice-booking" })).status, 401);
      for (let attempt = 0; attempt < 5; attempt++) {
        const refusal = yield* post("sign_in", {
          email: credentials.email,
          password: "wrong password",
        });
        assert.strictEqual(refusal.status, 200);
        assert.isNull(refusal.headers.get("set-cookie"));
      }
      const locked = yield* post("sign_in", {
        email: credentials.email,
        password: "new correct horse battery",
      });
      assert.strictEqual(locked.status, 200);
      assert.isNull(locked.headers.get("set-cookie"));
      assert.deepStrictEqual(yield* Effect.promise(() => locked.json()), {
        _tag: "InvalidCredentials",
      });
    }).pipe(Effect.scoped),
);
