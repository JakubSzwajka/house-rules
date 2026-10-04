declare module "@house-rules/rules" {
  interface RuleMeta {
    readonly type?: string;
    readonly fixable?: string;
    readonly docs?: { readonly description?: string };
    readonly messages?: Readonly<Record<string, string>>;
    readonly defaultOptions?: unknown;
  }
  const plugin: { readonly rules: Readonly<Record<string, { readonly meta: RuleMeta }>> };
  export default plugin;
}

declare module "@house-rules/rules/dependency-cruiser" {
  interface ForbiddenRule {
    readonly name: string;
    readonly severity: string;
    readonly module?: unknown;
  }
  export function layout(options: { readonly scope: string }): {
    readonly forbidden: readonly ForbiddenRule[];
  };
}
