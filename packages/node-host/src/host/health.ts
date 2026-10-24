export type ReadinessCheck = Readonly<{
  name: string;
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<unknown>;
}>;

export type HealthOptions = Readonly<{
  alivePath?: string;
  readyPath?: string;
  version?: string;
  checks?: readonly ReadinessCheck[];
  wayPaths: readonly string[];
}>;

const pathOf = (path: string): string => {
  if (
    !/^\/(?:[a-zA-Z0-9_.~-]+(?:\/[a-zA-Z0-9_.~-]+)*)?$/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError("Health and way paths must be plain absolute paths");
  }
  return path.toLowerCase();
};

const overlaps = (a: string, b: string): boolean =>
  a === b || a === "/" || b === "/" || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

const passes = async (check: ReadinessCheck, signal: AbortSignal): Promise<boolean> => {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => check.run(combined))
        .then(
          () => true,
          () => false,
        ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, check.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const healthHandler = (options: HealthOptions) => {
  if (!Array.isArray(options.wayPaths)) {
    throw new TypeError("Health probes require a wayPaths list");
  }
  const version = options.version;
  const alive = options.alivePath ?? "/healthz";
  const ready = options.readyPath ?? "/readyz";
  const aliveKey = pathOf(alive);
  const readyKey = pathOf(ready);
  const ways = options.wayPaths.map((path) => {
    const decoded =
      decodeURIComponent(path)
        .replace(/\/{2,}/g, "/")
        .replace(/\/$/, "") || "/";
    return pathOf(decoded);
  });
  if (
    overlaps(aliveKey, readyKey) ||
    ways.some((way) => overlaps(aliveKey, way) || overlaps(readyKey, way))
  ) {
    throw new TypeError("Health paths collide with each other or a way path");
  }
  // Capture startup values; later mutation must not move paths or replace checks.
  const checks = (options.checks ?? []).map((check) => ({ ...check }));
  const names = new Set<string>();
  for (const check of checks) {
    if (!/^[a-zA-Z0-9_-]+$/.test(check.name) || names.has(check.name)) {
      throw new TypeError("Readiness check names must be unique plain names");
    }
    if (
      !Number.isSafeInteger(check.timeoutMs) ||
      check.timeoutMs <= 0 ||
      check.timeoutMs > 2_147_483_647
    ) {
      throw new TypeError("Readiness timeoutMs must be a positive timer duration");
    }
    names.add(check.name);
  }
  return async (request: Request, method = request.method): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (path !== alive && path !== ready) return undefined;
    if (method !== "GET" && method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const failed =
      path === alive
        ? []
        : (
            await Promise.all(
              checks.map(async (check) =>
                (await passes(check, request.signal)) ? [] : [check.name],
              ),
            )
          ).flat();
    const body = JSON.stringify({
      ...(failed.length === 0 ? { status: "ok" } : { status: "unavailable", failed }),
      ...(path === ready && version !== undefined ? { version } : {}),
    });
    return new Response(method === "HEAD" ? null : body, {
      status: failed.length === 0 ? 200 : 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  };
};

export const healthRoutes = (options: HealthOptions) => {
  const dispatch = healthHandler(options);
  const route = async (request: Request): Promise<Response> =>
    (await dispatch(request)) ?? new Response(null, { status: 404 });
  return {
    healthz: { GET: route, HEAD: route },
    readyz: { GET: route, HEAD: route },
  };
};
