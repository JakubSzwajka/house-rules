export type RequestBase = Readonly<{ href: string; origin: string }>;

const httpOrigin = (url: URL): string | undefined =>
  // An opaque origin is "null" for every such URL, so it cannot tell two apart.
  url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;

const unclean = /[\u0000-\u0020\u007f\\]/u;

const absolute = /^https?:\/\/(?<authority>[^/?#]*)/iu;

const refuse = (who: string, baseUrl: string, why: string) =>
  new TypeError(`${who}: baseUrl ${JSON.stringify(baseUrl)} ${why}`);

const fixedBase = (who: string, baseUrl: string): RequestBase => {
  // A parser drops spaces and controls, reads `\` as `/`, and guesses a host in `http:host`.
  const authority = unclean.test(baseUrl) ? undefined : absolute.exec(baseUrl)?.groups?.authority;
  if (authority === undefined || authority === "") {
    throw refuse(
      who,
      baseUrl,
      "must be an absolute http:// or https:// URL, such as https://api.example",
    );
  }
  if (authority.includes("@")) throw refuse(who, baseUrl, "must not carry credentials");
  if (baseUrl.includes("?") || baseUrl.includes("#")) {
    throw refuse(who, baseUrl, "must not carry a query or a fragment");
  }
  let origin: string | undefined;
  try {
    origin = httpOrigin(new URL(baseUrl));
  } catch {
    origin = undefined;
  }
  if (origin === undefined) throw refuse(who, baseUrl, "is not a valid URL");
  return { href: baseUrl, origin };
};

const pageBase = (): RequestBase | undefined => {
  const page = (globalThis as { location?: { origin?: unknown } }).location;
  if (typeof page?.origin !== "string") return undefined;
  try {
    const origin = httpOrigin(new URL(page.origin));
    return origin === undefined ? undefined : { href: origin, origin };
  } catch {
    return undefined;
  }
};

export const requestBaseOf = (
  who: string,
  baseUrl: string | undefined,
): (() => RequestBase | undefined) => {
  // A bad baseUrl throws when the client is built; with none, each call reads the page.
  if (baseUrl === undefined) return pageBase;
  const fixed = fixedBase(who, baseUrl);
  return () => fixed;
};

export const pathStaysOn = (path: string, base: RequestBase): boolean => {
  // A path that names a host on its own, such as `//host` or `/\t/host`, is a bug even behind a base.
  try {
    return httpOrigin(new URL(path, base.origin)) === base.origin;
  } catch {
    return false;
  }
};

export const onBaseOrigin = (url: string, base: RequestBase | undefined): URL | undefined => {
  if (base === undefined) return undefined;
  try {
    // No base given: the URL is the absolute string the transport gets, so nothing else resolves it.
    const parsed = new URL(url);
    return httpOrigin(parsed) === base.origin ? parsed : undefined;
  } catch {
    return undefined;
  }
};
