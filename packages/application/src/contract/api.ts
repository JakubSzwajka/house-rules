import type { Endpoint } from "./endpoint.ts";

export type ApiEndpoints = Readonly<Record<string, Endpoint>>;

export type ApiOptions = Readonly<{ prefix?: "" | `/${string}` }>;

export type Api<Endpoints extends ApiEndpoints = ApiEndpoints> = Readonly<{
  _tag: "Api";
  prefix: "" | `/${string}`;
  endpoints: Endpoints;
}>;

const routeKey = (shape: Endpoint): string =>
  // `:id` and `:bookingId` in the same place are one route to the router.
  `${shape.method} ${shape.path.replace(/\/:[^/]+/gu, "/:")}`;

const plainPrefix = /^(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/u;

const checkedPrefix = (prefix: string | undefined): "" | `/${string}` => {
  if (prefix === undefined) return "";
  if (!plainPrefix.test(prefix)) {
    // Definition time, not a request: the prefix is glued in front of every path, so it must be plain.
    throw new TypeError(`defineApi: prefix ${JSON.stringify(prefix)} is not "/<plain path>"`);
  }
  return prefix as "" | `/${string}`;
};

const plainSegment = /^(?::[A-Za-z_][A-Za-z0-9_]*|[A-Za-z0-9._~-]+)$/u;

const plainPath = (path: string): boolean =>
  path === "/" ||
  (path.startsWith("/") &&
    path
      .slice(1)
      .split("/")
      .every((segment) => plainSegment.test(segment) && segment !== "." && segment !== ".."));

const checkedPath = (key: string, path: string): void => {
  // Definition time, not a request: a URL parser rewrites controls, `\\`, `%` and dot segments, so only plain ones pass.
  if (!plainPath(path)) {
    throw new TypeError(
      `defineApi: ${key} path ${JSON.stringify(path)} is not "/<plain segments>" (letters, digits, . _ ~ - or :name)`,
    );
  }
};

export const defineApi = <const Endpoints extends Record<string, Endpoint>>(
  options: ApiOptions,
  endpoints: Endpoints,
): Api<Readonly<Endpoints>> => {
  const prefix = checkedPrefix(options.prefix);
  const routes = new Map<string, string>();
  const names = new Map<string, string>();
  for (const [key, shape] of Object.entries(endpoints)) {
    checkedPath(key, shape.path);
    const at = routeKey(shape);
    const name = shape.contract.name;
    // Definition time, not a request: two entries on one address, or one contract twice, cannot both be served.
    const route = routes.get(at);
    if (route !== undefined) {
      throw new TypeError(
        `defineApi: ${key} and ${route} both answer ${shape.method} ${shape.path}`,
      );
    }
    const named = names.get(name);
    if (named !== undefined) {
      throw new TypeError(`defineApi: ${key} and ${named} both name the contract ${name}`);
    }
    routes.set(at, key);
    names.set(name, key);
  }
  return Object.freeze({
    _tag: "Api",
    prefix,
    endpoints: Object.freeze({ ...endpoints }),
  });
};
