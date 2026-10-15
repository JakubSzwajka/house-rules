import type { AnyContract } from "./contract.ts";
import { checkSessionPlace, type SessionOption, type SessionRole } from "./session.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type EndpointOptions<
  Code extends string = never,
  Session extends "issue" | "clear" = "issue" | "clear",
> = Readonly<{
  status?: number;
  codes?: ReadonlyArray<Code>;
  session?: Session;
}>;

export type EndpointShape<
  C extends AnyContract = AnyContract,
  Code extends string = string,
  Session extends SessionRole = SessionRole,
> = Readonly<{
  contract: C;
  method: Method;
  path: `/${string}`;
  status: number;
  codes: ReadonlyArray<Code>;
  session: Session;
}>;

export type Endpoint<
  C extends AnyContract = AnyContract,
  Code extends string = string,
  Session extends SessionRole = SessionRole,
> = EndpointShape<C, Code, Session> & Readonly<{ _tag: "Endpoint" }>;

type SessionOf<S> = [S] extends [never] ? "none" : S;

export const failureCodeHeader = "x-failure-code";

const codePattern = /^[a-z][a-z0-9_]*$/u;

const checkedCodes = <Code extends string>(
  name: string,
  codes: ReadonlyArray<Code>,
): ReadonlyArray<Code> => {
  for (const code of codes) {
    if (!codePattern.test(code)) {
      // Definition time, not a request: a code goes out in a header, so it must be a plain token.
      throw new TypeError(`${name}: failure code ${JSON.stringify(code)} is not snake_case`);
    }
  }
  return [...new Set(codes)];
};

export const writeMethods: ReadonlySet<Method> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const methods: ReadonlySet<string> = new Set(["GET", ...writeMethods]);

export const parseAt = (
  name: string,
  at: `${Method} /${string}` | undefined,
): Readonly<{ method: Method; path: `/${string}` }> => {
  const [method, path] = (at ?? `POST /${name}`).split(" ");
  if (method === undefined || !methods.has(method) || path?.startsWith("/") !== true) {
    // Definition time, not a request: a route the router cannot mount must fail loudly.
    throw new TypeError(`${name}: ${JSON.stringify(at)} is not "<METHOD> /<path>"`);
  }
  return { method: method as Method, path: path as `/${string}` };
};

export const endpoint = <
  C extends AnyContract,
  const Code extends string = never,
  const Session extends SessionOption<C> = never,
>(
  contract: C,
  at?: `${Method} /${string}`,
  options: EndpointOptions<Code, Session> = {},
): Endpoint<C, NoInfer<Code>, SessionOf<Session>> => {
  const place = parseAt(contract.name, at);
  const session = (options.session ?? "none") as SessionOf<Session>;
  checkSessionPlace(contract.name, place.method, session, contract.output);
  return {
    _tag: "Endpoint",
    contract,
    ...place,
    status: options.status ?? 200,
    codes: checkedCodes(contract.name, options.codes ?? []),
    session,
  };
};

const paramSegment = /^:([A-Za-z_][A-Za-z0-9_]*)$/u;

export const pathParamNames = (shape: EndpointShape): ReadonlyArray<string> =>
  shape.path
    .split("/")
    .slice(1)
    .flatMap((segment) => {
      const param = paramSegment.exec(segment)?.[1];
      if (param !== undefined) return [param];
      if (/[:*?]/u.test(segment)) {
        throw new TypeError(
          `${shape.contract.name}: path segment ${JSON.stringify(segment)} is not a plain :name`,
        );
      }
      return [];
    });
