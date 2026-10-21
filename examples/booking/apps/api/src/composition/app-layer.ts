import { makeBookingBinding } from "../features/make-booking/handler.ts";
import { partnerBookingBinding } from "../features/book-for-partner/handler.ts";
import { cancelBookingBinding } from "../features/cancel-booking/handler.ts";
import { showBookingBinding } from "../features/show-booking/handler.ts";
import { myBookingsBinding } from "../features/my-bookings/handler.ts";
import { firstSignInNodeBinding } from "../features/first-sign-in/handler.ts";
import { nightlyCleanupNodeBinding } from "../features/nightly-cleanup/handler.ts";
import { NodeRuntime, CurrentActor, type NodeRuntimeOptions } from "@house-rules/application";
import { Bookings, bindBookings } from "@example/bookings";
import { Billing, bindBilling } from "@example/billing";
import { MyStuff, bindMyStuff } from "../read-models/my-bookings/index.ts";
import { Party, bindParty } from "@house-rules/party";
import { Identity, bindIdentity } from "@house-rules/identity";
import { CallAudit } from "@house-rules/call-audit";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { AuditStorage } from "./audit-storage.ts";
import { DemoIssuers } from "./demo-issuers.ts";
import { McpAuthenticator } from "./mcp-authenticator.ts";
import { newLoginHook } from "./first-sign-in.ts";
import { Entries } from "./entries.ts";
import { modulesLayer } from "./modules.ts";
export const auditOptions = {
  who: Effect.serviceOption(CurrentActor).pipe(
    Effect.map(Option.match({ onNone: () => null, onSome: (actor) => actor.id })),
  ),
  policy: CallAudit.presets.strict,
};
export const linkModules = (ways: NodeRuntimeOptions["ways"]) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const bookings = yield* Bookings;
      const billing = yield* Billing;
      const read = yield* MyStuff;
      const party = yield* Party;
      const identity = yield* Identity;
      return NodeRuntime.layer({
        bindings: [
          ...bindBookings(bookings),
          ...bindBilling(billing),
          ...bindMyStuff(read),
          ...bindParty(party),
          ...bindIdentity(identity),
          makeBookingBinding,
          partnerBookingBinding,
          cancelBookingBinding,
          showBookingBinding,
          myBookingsBinding,
          firstSignInNodeBinding,
          nightlyCleanupNodeBinding,
        ],
        entries: Object.values(Entries),
        ways,
      });
    }),
  );
export const plugSockets = <E>(
  modules: Layer.Layer<Layer.Success<ReturnType<typeof modulesLayer>>, E>,
  ways: NodeRuntimeOptions["ways"] = [],
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
