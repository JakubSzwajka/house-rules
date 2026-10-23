export interface MapEdge {
  readonly target: string;
  readonly kind: "operation" | "feature";
  readonly reason?: string;
}
export interface MapOperation {
  readonly name: string;
  readonly permission: string | null;
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly edges: readonly MapEdge[];
}
export interface MapModule {
  readonly name: string;
  readonly service: string;
  readonly kind: "package" | "read-model";
  readonly package?: string;
  readonly path?: string;
  readonly operations: readonly MapOperation[];
}
export interface MapPlug {
  readonly name: string;
  readonly package?: string;
  readonly fills: string;
  readonly ways?: readonly string[];
}
export interface AppMapSnapshot {
  readonly layers: string;
  readonly modules: readonly MapModule[];
  readonly features: readonly Readonly<{
    name: string;
    path?: string;
    start: "person" | Readonly<{ kind: "system"; reason: string; startedBy: string }>;
    permission: string | null;
    flags: Readonly<{
      readOnly: boolean;
      destructive: boolean;
      transactional: boolean;
      needsApproval: boolean;
    }>;
    closures: Readonly<{ person: readonly string[]; system: readonly string[] }>;
    edges: readonly MapEdge[];
    ways: readonly string[];
  }>[];
  readonly ways: readonly Readonly<{
    name: string;
    protocol: "http" | "mcp" | "hook" | "schedule";
    path?: string;
    source?: string;
    mean?: string;
    slot?: string;
    clock?: Readonly<{ cron: string; timeZone: string }>;
    features: readonly string[];
    public: readonly string[];
  }>[];
  readonly permissions: readonly Readonly<{ name: string; operations: readonly string[] }>[];
  readonly plugs?: readonly MapPlug[];
}
