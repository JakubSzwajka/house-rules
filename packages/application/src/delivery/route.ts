import { type Endpoint, type EndpointShape, type Method, parseAt } from "../contract/endpoint.ts";
import type { Mountable } from "./invoke.ts";

export type CsrfOptOut = Readonly<{ skip: true; reason: string }>;

export type RouteOptions = Readonly<{ status?: number; csrf?: CsrfOptOut }>;

export type Route<Cap extends Mountable = Mountable> = EndpointShape<Cap["contract"]> &
  Readonly<{
    _tag: "Route";
    capability: Cap;
    csrf: "check" | CsrfOptOut;
    apiPrefix?: "" | `/${string}`;
  }>;

const placeOf = (
  capability: Mountable,
  at: `${Method} /${string}` | Endpoint | undefined,
  status: number | undefined,
): Readonly<{
  method: Method;
  path: `/${string}`;
  status: number;
  codes: ReadonlyArray<string>;
}> => {
  if (typeof at !== "object")
    return { ...parseAt(capability.contract.name, at), status: status ?? 200, codes: [] };
  // Mount time, not a request: an endpoint shared with a client must describe this very capability.
  if (at.contract !== capability.contract) {
    const [named, given] = [at.contract.name, capability.contract.name];
    const clash = named === given ? `another contract object named ${given}` : given;
    throw new TypeError(
      `route ${at.method} ${at.path} names ${named}, not ${clash}; contracts match by identity`,
    );
  }
  if (status !== undefined) {
    throw new TypeError(`route ${at.method} ${at.path} takes its status from the endpoint`);
  }
  return { method: at.method, path: at.path, status: at.status, codes: at.codes };
};

export const route = <Cap extends Mountable>(
  capability: Cap,
  at?: `${Method} /${string}` | Endpoint<Cap["contract"]>,
  options: RouteOptions = {},
): Route<Cap> => {
  const { method, path, status, codes } = placeOf(capability, at, options.status);
  if (options.csrf !== undefined && options.csrf.reason.trim() === "") {
    // Mount time, not a request: a route that skips the Origin check must say why.
    throw new TypeError(`route ${method} ${path} skips the CSRF check without a reason`);
  }
  return {
    _tag: "Route",
    capability,
    contract: capability.contract,
    method,
    path,
    status,
    codes,
    csrf: options.csrf ?? "check",
  };
};
