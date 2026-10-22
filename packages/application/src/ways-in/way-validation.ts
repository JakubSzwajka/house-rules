import { isPlainPath, isPlainPrefix } from "../contract/api.ts";
import { pathParamNames } from "../contract/endpoint.ts";
import { checkSessionPlace } from "../contract/session.ts";
import type { AnyFeature } from "../feature/feature.ts";
import type { WayOptions } from "./way.ts";
import { prefixMismatch } from "./api-prefix.ts";
import { checkCors } from "./cors.ts";
import { isHttpOrigin } from "./csrf.ts";
import { checkSession } from "./session-cookie.ts";

type ErasedWay<W> = W extends unknown
  ? Omit<W, "overrides"> & Readonly<{ overrides?: Readonly<Record<string, unknown>> }>
  : never;
export type AnyWay<R = never> = ErasedWay<WayOptions<R>>;

export const validateWays = <R>(
  features: readonly AnyFeature[],
  ways: readonly AnyWay<R>[],
): string | undefined => {
  const names = new Set<string>();
  const paths = new Set<string>();
  const routes = new Set<string>();
  const httpPaths = new Set<string>();
  const reservedPaths = new Set<string>();
  for (const way of ways) {
    if (names.has(way.name)) return `Duplicate way name ${way.name}`;
    if (paths.has(way.path.toLowerCase())) return `Duplicate way path ${way.path}`;
    if (way.path !== "/" && !isPlainPrefix(way.path)) return `Invalid way path ${way.path}`;
    if (way.protocol === "mcp" && way.public !== undefined)
      return "MCP ways cannot expose public features";
    if (way.protocol === "http") {
      for (const feature of way.public ?? []) {
        if (!way.features.includes(feature)) return "Public features must be exposed by the way";
        if (feature.start === "person") return "Public features must declare a system start";
      }
    }
    names.add(way.name);
    paths.add(way.path.toLowerCase());
    if (
      new Set(way.features).size !== way.features.length ||
      new Set(way.features.map((feature) => feature)).size !== way.features.length
    )
      return `${way.name} exposes an feature twice`;
    for (const feature of way.features)
      if (!features.includes(feature)) return `${way.name} exposes an unregistered feature`;
    const exposed =
      way.protocol === "http"
        ? way.endpoints.map((shape) => shape.feature)
        : way.tools.map((tool) => tool.feature);
    for (const feature of exposed)
      if (!way.features.includes(feature))
        return `${way.name} serves an feature it does not expose`;
    for (const feature of way.features)
      if (!exposed.includes(feature)) return `${way.name} has an feature with no endpoint/tool`;
    if (way.protocol === "http") {
      const mismatch = prefixMismatch(way.endpoints, way.path === "/" ? "" : way.path);
      if (mismatch !== undefined) return mismatch;
      try {
        checkCors(way.cors);
        checkSession(way.session, way.endpoints);
        if ((way.origins ?? []).some((origin) => !isHttpOrigin(origin)))
          return `${way.name}: invalid origins`;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid HTTP way options";
      }
      if (
        way.maxBodyBytes !== undefined &&
        (!Number.isSafeInteger(way.maxBodyBytes) || way.maxBodyBytes <= 0)
      )
        return `${way.name}: invalid maxBodyBytes`;
      for (const shape of way.endpoints) {
        if (!isPlainPath(shape.path)) return `${way.name}: invalid endpoint path ${shape.path}`;
        if (!Number.isInteger(shape.status) || shape.status < 200 || shape.status >= 300)
          return `${way.name}: invalid success status ${shape.status}`;
        try {
          const params = pathParamNames(shape);
          if (new Set(params).size !== params.length) return `${way.name}: repeated path parameter`;
          checkSessionPlace(shape.feature.name, shape.method, shape.session, shape.feature.output);
          if (
            shape.csrf !== "check" &&
            (shape.csrf.reason.trim() === "" || shape.session !== "none")
          )
            return `${way.name}: invalid CSRF opt-out`;
        } catch (error) {
          return error instanceof Error ? error.message : "Invalid endpoint";
        }
        const path = `${way.path === "/" ? "" : way.path}${shape.path}`.toLowerCase();
        if (reservedPaths.has(path)) return `HTTP endpoint collides with MCP path ${path}`;
        httpPaths.add(path);
        const key = `${shape.method} ${path.replace(/\/:[^/]+/gu, "/:")}`;
        if (routes.has(key)) return `Duplicate endpoint ${key}`;
        routes.add(key);
      }
    } else {
      if (new Set(exposed).size !== exposed.length) return `${way.name} exposes a tool twice`;
      for (const path of [way.path, ...way.resource.paths]) {
        const normalized = path.toLowerCase();
        if (reservedPaths.has(normalized) || httpPaths.has(normalized))
          return `Duplicate MCP/metadata path ${path}`;
        reservedPaths.add(normalized);
      }
    }
  }
};
