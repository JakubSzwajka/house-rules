import type { AnyCallable } from "@house-rules/domain";
import { type Context, Effect, Layer } from "effect";
import type { MountMap } from "../registry/registry.ts";
import type { MapPlug } from "../registry/app-map-snapshot.ts";
import { PermissionCatalogue } from "../registry/catalogue.ts";
import { permissionCatalogue } from "../registry/permission-catalogue.ts";
import { GraphInvalid } from "./graph-invalid.ts";
import type { Binding } from "./binding.ts";

export type Operation = AnyCallable & { readonly kind: "operation" };
export type MountDefinition<I, S> = Readonly<{
  map?: MountMap;
  service: Context.Key<I, S>;
  operations: readonly Operation[];
  bind: (service: S) => readonly Binding[];
}>;
export type ModuleMount<I, S, A = I, E = never, R = never> = MountDefinition<I, S> &
  Readonly<{ layer: Layer.Layer<A, E, R> }>;
export type Mounts = readonly ModuleMount<any, any, never, any, any>[];
type CheckedMount<M> =
  M extends MountDefinition<any, any>
    ? M & { readonly bind: (service: Context.Service.Shape<M["service"]>) => readonly Binding[] }
    : never;
export type CheckedMounts<M extends readonly MountDefinition<any, any>[]> = {
  readonly [K in keyof M]: CheckedMount<M[K]>;
};
type ServiceOf<M> = M extends MountDefinition<infer I, any> ? I : never;
export type Services<M extends readonly MountDefinition<any, any>[]> = ServiceOf<M[number]>;
export type ModulePlan<M extends Mounts, A, E = never, R = never> = Readonly<{
  mounts: M;
  layer: Layer.Layer<A, E, R>;
  plugs?: readonly MapPlug[];
}>;
export type MissingMountServices<M extends Mounts> = {
  [K in keyof M]: Exclude<
    Context.Service.Identifier<M[K]["service"]>,
    Layer.Success<M[K]["layer"]>
  >;
}[number];

export const planLayer = <const M extends Mounts, A, E, R>(
  plan: ModulePlan<M, A, E, R> & { readonly mounts: CheckedMounts<M> },
): Layer.Layer<
  A | Layer.Success<M[number]["layer"]> | PermissionCatalogue,
  E | Layer.Error<M[number]["layer"]> | GraphInvalid,
  Exclude<R | Exclude<Layer.Services<M[number]["layer"]>, A>, PermissionCatalogue>
> => {
  const permissions = permissionCatalogue(plan.mounts.flatMap((mount) => mount.operations));
  const catalogue = Layer.succeed(PermissionCatalogue, {
    permissions: () => Effect.succeed(permissions),
  });
  // Erase only the heterogeneous merge; the public signature retains each layer's types.
  type MountLayer = Layer.Layer<
    Layer.Success<M[number]["layer"]>,
    Layer.Error<M[number]["layer"]>,
    Layer.Services<M[number]["layer"]>
  >;
  const mounts = plan.mounts as unknown as readonly { readonly layer: MountLayer }[];
  const layers = mounts.map((mount) => mount.layer);
  const merged = layers.reduce<MountLayer>(
    (all, layer) => Layer.merge(all, layer),
    Layer.empty as unknown as MountLayer,
  );
  return Layer.unwrap(
    Effect.gen(function* () {
      const invalid = validateMounts(plan.mounts);
      if (invalid !== undefined) return yield* new GraphInvalid({ reason: invalid });
      return merged.pipe(Layer.provideMerge(plan.layer), Layer.provideMerge(catalogue));
    }),
  ) as Layer.Layer<
    A | Layer.Success<M[number]["layer"]> | PermissionCatalogue,
    E | Layer.Error<M[number]["layer"]> | GraphInvalid,
    Exclude<R | Exclude<Layer.Services<M[number]["layer"]>, A>, PermissionCatalogue>
  >;
};

export const validateMounts = (
  mounts: readonly MountDefinition<any, any>[],
): string | undefined => {
  const services = new Set<string>();
  const identities = new Set<Operation>();
  const names = new Set<string>();
  for (const mount of mounts) {
    if (services.has(mount.service.key)) return `Duplicate mount service ${mount.service.key}`;
    services.add(mount.service.key);
    for (const operation of mount.operations) {
      if (identities.has(operation)) return `Duplicate mounted operation ${operation.name}`;
      if (names.has(operation.name)) return `Duplicate operation name ${operation.name}`;
      identities.add(operation);
      names.add(operation.name);
    }
  }
};
