import * as NodePlatform from "@effect/platform-node";
import { Identity } from "@house-rules/identity";
import { Party } from "@house-rules/party";
import { UnitOfWork } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { planLayer } from "@house-rules/application";
import { appConfig, modulePlan } from "../src/composition/app.ts";

class GrantAdminRefused extends Schema.TaggedError<GrantAdminRefused>()("GrantAdminRefused", {
  message: Schema.String,
}) {}
export const grantAdmin = Effect.fn("grantAdmin")(function* (
  email: string,
  options: { readonly nodeEnv: string; readonly yesProduction: boolean },
) {
  if (options.nodeEnv === "production" && !options.yesProduction)
    return yield* new GrantAdminRefused({ message: "Production requires --yes-production." });
  if (!email.trim())
    return yield* new GrantAdminRefused({
      message: "Usage: grant-admin <existing-account-email> [--yes-production]",
    });
  const identity = yield* Identity;
  const party = yield* Party;
  return yield* UnitOfWork.atomic(
    Effect.gen(function* () {
      const account = yield* identity.accountByEmail(email).pipe(
        Effect.catchTag(
          "PasswordAccountNotFound",
          () =>
            new GrantAdminRefused({
              message:
                "No bound password account for that email. Sign up, then sign in once in the page first.",
            }),
        ),
      );
      yield* party.assignRole(
        {
          kind: "system",
          reason: "server operator granted admin",
          startedBy: "script:grant-admin",
        },
        {
          personId: account.actorId,
          roleKey: "admin",
          organisationId: null,
        },
      );
      return account.actorId;
    }),
  );
});
if (process.argv[1]?.endsWith("/grant-admin.js")) {
  Effect.gen(function* () {
    const settings = yield* appConfig;
    const id = yield* grantAdmin(process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "", {
      nodeEnv: settings.nodeEnv,
      yesProduction: process.argv.includes("--yes-production"),
    }).pipe(Effect.provide(planLayer(modulePlan({ settings }))));
    yield* Effect.log(`Granted admin to person ${id}.`);
  }).pipe(NodePlatform.NodeRuntime.runMain);
}
