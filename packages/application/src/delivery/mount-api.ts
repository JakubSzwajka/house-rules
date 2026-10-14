import type { Api, ApiEndpoints } from "../contract/api.ts";
import { type Route, route } from "./route.ts";
import type { Mountable } from "./invoke.ts";

export type CapabilitiesOf<Endpoints extends ApiEndpoints> = {
  readonly [Key in keyof Endpoints]: Mountable & Readonly<{ contract: Endpoints[Key]["contract"] }>;
};

type NoExtraKeys<Given, Endpoints> = {
  readonly [Key in Exclude<keyof Given, keyof Endpoints>]: never;
};

type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExactContracts<Capabilities, Endpoints extends ApiEndpoints> = {
  readonly [Key in keyof Endpoints & keyof Capabilities]: Capabilities[Key] extends Readonly<{
    contract: infer Given;
  }>
    ? Same<Given, Endpoints[Key]["contract"]> extends true
      ? unknown
      : {
          readonly contractTypeDiffers: Endpoints[Key]["contract"]["name"];
        }
    : unknown;
};

export const mount = <
  const Endpoints extends ApiEndpoints,
  const Capabilities extends CapabilitiesOf<Endpoints>,
>(
  api: Api<Endpoints>,
  capabilities: Capabilities &
    NoExtraKeys<Capabilities, Endpoints> &
    ExactContracts<Capabilities, Endpoints>,
): ReadonlyArray<Route<Capabilities[keyof Endpoints]>> => {
  const given: Readonly<Record<string, Mountable | undefined>> = capabilities;
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(api.endpoints, key)) {
      // Mount time, not a request: a capability with no endpoint would never be served.
      throw new TypeError(`mount: ${key} is not in the API list`);
    }
  }
  return Object.freeze(
    Object.entries(api.endpoints).map(([key, shape]) => {
      const capability = given[key];
      if (capability === undefined) {
        // Mount time, not a request: an endpoint the client can call must have a handler.
        throw new TypeError(`mount: ${key} has no capability`);
      }
      // route() throws when the endpoint names another contract than the capability's.
      const mounted = route(capability, shape);
      return Object.freeze({
        ...mounted,
        path: `${api.prefix}${mounted.path}` as const,
        apiPrefix: api.prefix,
      });
    }),
  ) as ReadonlyArray<Route<Capabilities[keyof Endpoints]>>;
};
