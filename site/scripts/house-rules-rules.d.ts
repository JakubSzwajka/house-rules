declare module "@house-rules/rules" {
  interface RuleMeta {
    readonly docs?: { readonly description?: string; readonly url?: string };
  }
  const plugin: { readonly rules: Readonly<Record<string, { readonly meta: RuleMeta }>> };
  export const SITE_URL: string;
  export const RULES_PAGE_URL: string;
  export function ruleAnchor(id: string): string;
  export function ruleDocsUrl(id: string): string;
  export default plugin;
}
