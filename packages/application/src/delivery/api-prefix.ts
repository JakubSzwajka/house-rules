type Placed = Readonly<{ method: string; path: string; apiPrefix?: string }>;

export const checkPrefixOwner = (
  routes: ReadonlyArray<Placed>,
  prefix: string | undefined,
  adapter = "toFetchHandler",
) => {
  const fromApi = routes.find((each) => each.apiPrefix !== undefined);
  if (prefix !== undefined && fromApi !== undefined) {
    // Mount time, not a request: the API list owns the prefix the client also reads, so a second one would split them.
    throw new TypeError(
      `${adapter}: ${fromApi.method} ${fromApi.path} comes from an API list, which owns the prefix; drop the prefix option`,
    );
  }
};
