import { type Endpoint, type EndpointShape, type Method, parseAt } from "../contract/endpoint.ts";
import { checkSessionPlace, type SessionOption, type SessionRole } from "../contract/session.ts";
import type { Mountable } from "./invoke.ts";

export type CsrfOptOut = Readonly<{ skip: true; reason: string }>;

export type RouteOptions<Session extends "issue" | "clear" = "issue" | "clear"> = Readonly<{
  status?: number;
  csrf?: CsrfOptOut;
  session?: Session;
}>;

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
  session: SessionRole | undefined,
): Readonly<{
  method: Method;
  path: `/${string}`;
  status: number;
  codes: ReadonlyArray<string>;
  session: SessionRole;
}> => {
  if (typeof at !== "object") {
    const place = parseAt(capability.contract.name, at);
    return { ...place, status: status ?? 200, codes: [], session: session ?? "none" };
  }
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
  if (session !== undefined) {
    throw new TypeError(`route ${at.method} ${at.path} takes its session from the endpoint`);
  }
  return {
    method: at.method,
    path: at.path,
    status: at.status,
    codes: at.codes,
    session: at.session,
  };
};

export const route = <Cap extends Mountable>(
  capability: Cap,
  at?: `${Method} /${string}` | Endpoint<Cap["contract"]>,
  options: RouteOptions<SessionOption<Cap["contract"]>> = {},
): Route<Cap> => {
  const place = placeOf(capability, at, options.status, options.session);
  const { method, path, status, codes, session } = place;
  if (options.csrf !== undefined && options.csrf.reason.trim() === "") {
    // Mount time, not a request: a route that skips the Origin check must say why.
    throw new TypeError(`route ${method} ${path} skips the CSRF check without a reason`);
  }
  if (options.csrf !== undefined && session !== "none") {
    // Mount time, not a request: a cookie route without the Origin check invites login and logout CSRF.
    throw new TypeError(`route ${method} ${path} sets a session cookie, so it cannot skip CSRF`);
  }
  checkSessionPlace(`route ${method} ${path}`, method, session, capability.contract.output);
  return {
    _tag: "Route",
    capability,
    contract: capability.contract,
    method,
    path,
    status,
    codes,
    session,
    csrf: options.csrf ?? "check",
  };
};
