import { Runtime, type RuntimeOptions } from "@house-rules/application";
import { Bookings, bindBookings } from "@example/bookings";
import { Billing, bindBilling } from "@example/billing";
import { MyStuff, bindMyStuff } from "../read-models/my-bookings/index.ts";
import { Party, bindParty } from "@house-rules/party";
import { Identity, bindIdentity } from "@house-rules/identity";
import { Context, Effect, Layer } from "effect";
import { DemoIssuers } from "./demo-issuers.ts";
import { McpAuthenticator } from "./mcp-authenticator.ts";
import { newLoginHook } from "./first-sign-in.ts";
import { Features } from "../features/index.ts";
import { modulesLayer } from "./modules.ts";
import { Catalogue } from "./catalogue.ts";
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
  const linked = linkModules(ways).pipe(Layer.provideMerge(modules));
  return Layer.mergeAll(
    newLoginHook.pipe(Layer.provideMerge(linked)),
    DemoIssuers.layer(nodeEnv),
    McpAuthenticator.layer(mcpIssuer),
  );
};
