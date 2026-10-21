import { Runtime, CurrentActor, type RuntimeOptions } from "@house-rules/application";
import { Bookings, bindBookings } from "@example/bookings";
import { Billing, bindBilling } from "@example/billing";
import { MyStuff, bindMyStuff } from "../read-models/my-bookings/index.ts";
import { Party, bindParty } from "@house-rules/party";
import { Identity, bindIdentity } from "@house-rules/identity";
import { CallAudit } from "@house-rules/call-audit";
import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { AuditStorage } from "./audit-storage.ts";
import { DemoIssuers } from "./demo-issuers.ts";
import { McpAuthenticator } from "./mcp-authenticator.ts";
import { newLoginHook } from "./first-sign-in.ts";
import { Features } from "../features/index.ts";
import { modulesLayer } from "./modules.ts";
import { Catalogue } from "./catalogue.ts";
export const auditOptions = {
  who: Effect.serviceOption(CurrentActor).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (actor) => actor.id })),
  ),
  policy: CallAudit.presets.strict,
};
export const linkModules = (ways: RuntimeOptions["ways"]) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      const billing = yield* Billing;
      const read = yield* MyStuff;
      const party = yield* Party;
      const identity = yield* Identity;
      const catalogue = yield* Catalogue;
      return Runtime.layer({
        bindings: [
          ...bindBookings(bookings),
          ...bindBilling(billing),
          ...bindMyStuff(read),
          ...bindParty(party),
          ...bindIdentity(identity),
        ],
        features: Object.values(Features),
        ways,
      }).pipe(
        Layer.tap((context) =>
          Effect.sync(() => {
            catalogue.install(Context.get(context, Runtime).permissions);
          }),
        ),
      );
    }),
  );
export const plugSockets = <E>(
  modules: Layer.Layer<Layer.Success<ReturnType<typeof modulesLayer>>, E>,
  ways: RuntimeOptions["ways"] = [],
  nodeEnv = "development",
  mcpIssuer = "",
) => {
  const record = Layer.unwrap(
    Effect.gen(function* () {
      const storage = yield* AuditStorage;
      return storage.kind === "memory"
        ? CallAudit.record.memory(storage.log, auditOptions).layer
        : CallAudit.record
            .postgres(auditOptions)
            .layer.pipe(Layer.provide(Layer.succeed(SqlClient, storage.client)));
    }),
  );
  const recorded = record.pipe(Layer.provideMerge(modules));
  const linked = linkModules(ways).pipe(Layer.provideMerge(recorded));
  return Layer.mergeAll(
    newLoginHook.pipe(Layer.provideMerge(linked)),
    DemoIssuers.layer(nodeEnv),
    McpAuthenticator.layer(mcpIssuer),
  );
};
