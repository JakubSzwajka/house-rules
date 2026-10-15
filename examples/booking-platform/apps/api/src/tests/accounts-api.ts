import {
  type CallEntry,
  composition,
  toFetchHandler,
  toPromiseClient,
} from "@house-rules/application";
import { Effect } from "effect";
import { memoryAppLayer } from "../composition/app-layer.js";
import { sessionCookie, visitorCaller } from "../composition/callers.js";
import { webCaller } from "../composition/index.js";
import { localSignIn, type SignInSettings } from "../composition/sign-in.js";
import { bookingViews } from "../composition/views.js";
import { api, publicApi, publicPaths, tokenApi } from "../delivery/http/api.js";
import { memberRoutes, publicRoutes } from "../delivery/http/routes.js";

export const origin = "https://booking.example";
export const password = "a long enough secret";

export const accountsApi = (settings: SignInSettings = localSignIn) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const app = composition({
        layer: memoryAppLayer(settings),
        caller: webCaller,
        views: bookingViews,
      });
      const members = toFetchHandler(app, { routes: memberRoutes });
      const accounts = toFetchHandler(app, {
        routes: publicRoutes,
        caller: visitorCaller,
        session: { cookie: sessionCookie },
      });
      const calls: CallEntry[] = [];
      const fetch = (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        return publicPaths.has(new URL(request.url).pathname)
          ? accounts(request)
          : members(request);
      };
      // A browser sends its page's Origin on every write; the session routes need it.
      const browserFetch = (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        if (!request.headers.has("origin")) request.headers.set("origin", origin);
        return fetch(request);
      };
      const visitor = toPromiseClient(publicApi, {
        baseUrl: origin,
        fetch: browserFetch,
        onCall: (entry) => calls.push(entry),
      });
      // A script signs in on /api/token with no Origin and gets the token in the body.
      const tokens = toPromiseClient(tokenApi, {
        baseUrl: origin,
        fetch,
        onCall: (entry) => calls.push(entry),
      });
      const as = (token: string) =>
        toPromiseClient(api, {
          baseUrl: origin,
          fetch,
          token: () => token,
          onCall: (entry) => calls.push(entry),
        });
      const signUpAndIn = (email: string, displayName: string) =>
        Effect.promise(() =>
          visitor
            .signUp({ email, password, displayName })
            .then(() => tokens.signIn({ email, password })),
        ).pipe(Effect.map(({ token }) => as(token)));
      return {
        app,
        members,
        accounts,
        fetch,
        browserFetch,
        visitor,
        tokens,
        as,
        signUpAndIn,
        calls,
      };
    }),
    ({ app, members, accounts }) =>
      Effect.promise(() =>
        Promise.all([members.dispose(), accounts.dispose()]).then(() => app.dispose()),
      ),
  );

export const rejection = (promise: Promise<unknown>) =>
  Effect.promise(() =>
    promise.then(
      () => "resolved",
      (error: unknown) => error,
    ),
  );
