import type { AnyCallable, SystemCaller } from "@house-rules/domain/contract";
import { Context, Effect, Layer } from "effect";
import {
  type AnyFeature,
  type AnyEntryPoint,
  type Binding,
  type CallScope,
  type Feature,
  CallerContext,
  defineFeature,
  Runtime,
} from "../index.ts";

const sources = new WeakMap<AnyEntryPoint, AnyCallable>();
const handlers = new WeakMap<AnyEntryPoint, Binding["run"]>();
const owners = new WeakMap<AnyEntryPoint["handler"], AnyEntryPoint>();
export function featureFixture<C extends AnyCallable>(callable: C): Feature<C>;
export function featureFixture<C extends AnyCallable, const S extends SystemCaller>(
  callable: C,
  options: Readonly<{ start: S }>,
): Feature<C, S>;
export function featureFixture(
  callable: AnyCallable,
  options?: Readonly<{ start: SystemCaller }>,
): unknown {
  let feature: AnyFeature;
  feature = defineFeature(callable.name, {
    ...callable,
    flags: {
      readOnly: callable.readOnly,
      destructive: callable.destructive,
      transactional: callable.transactional,
      needsApproval: callable.needsApproval,
    },
    ...(options === undefined ? {} : { start: options.start }),
    handler: (input, scope) =>
      Effect.suspend(() => {
        const handler = handlers.get(feature);
        return handler === undefined
          ? Effect.die("Feature fixture has no handler")
          : handler(input, scope).pipe(Effect.provideService(CallerContext, scope.caller));
      }),
  });
  sources.set(feature, callable);
  owners.set(feature.handler, feature);
  return feature;
}

export const installFixture = (feature: AnyEntryPoint, run: Binding["run"]): void => {
  handlers.set(owners.get(feature.handler) ?? feature, run);
};

type BindingOptions = Parameters<typeof Runtime.make>[0];
const prepare = (options: BindingOptions): BindingOptions => {
  const bindings = options.bindings.filter((binding) => {
    const features = options.features.filter(
      (feature) => sources.get(owners.get(feature.handler) ?? feature) === binding.callable,
    );
    for (const feature of features) installFixture(feature, binding.run);
    return features.length === 0;
  });
  return { ...options, bindings };
};
const bindingService = Context.Reference<undefined>("test/fixtureBindings", {
  defaultValue: () => undefined,
});
export const RuntimeFixture = {
  mounts: (options: BindingOptions) => {
    const bindings = prepare(options).bindings;
    return [
      {
        service: bindingService,
        operations: bindings.map((binding) => binding.callable),
        bind: () => bindings,
        layer: Layer.empty,
      },
    ] as const;
  },
  make: (options: BindingOptions) => Runtime.make(prepare(options)),
  layer: (options: BindingOptions) => Layer.effect(Runtime, Runtime.make(prepare(options))),
};
