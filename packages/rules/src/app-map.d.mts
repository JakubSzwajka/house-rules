export declare function appMapSources<
  A extends {
    readonly modules: readonly {
      readonly service: string;
      readonly operations: readonly { readonly name: string }[];
    }[];
    readonly features: readonly { readonly name: string }[];
    readonly ways: readonly { readonly name: string }[];
    readonly plugs?: readonly { readonly name: string; readonly fills: string }[];
  },
>(
  snapshot: A,
  options: {
    readonly appDirectory: string;
    readonly rootDirectory: string;
    readonly packageRoots: readonly string[];
  },
): Promise<A>;
