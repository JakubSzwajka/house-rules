import { Layer, ManagedRuntime } from "effect";
import type { Caller } from "./caller.ts";
import type { ViewTable } from "./views.ts";

export type Composition<A, C, Views extends ViewTable<C> = ViewTable<C>> = Readonly<{
  _tag: "Composition";
  runtime: ManagedRuntime.ManagedRuntime<A, never>;
  caller: Caller<C, A>;
  views: Views;
  dispose: () => Promise<void>;
}>;

export const composition = <A, E, C, const Views extends ViewTable<C> = Record<never, never>>(
  options: Readonly<{
    layer: Layer.Layer<A, E>;
    caller: Caller<C, A>;
    views?: Views;
  }>,
): Composition<A, C, Views> => {
  // One runtime builds the layer once, on first use, so every adapter shares its pools.
  const runtime = ManagedRuntime.make(Layer.orDie(options.layer));
  return {
    _tag: "Composition",
    runtime,
    caller: options.caller,
    views: options.views ?? ({} as Views),
    dispose: () => runtime.dispose(),
  };
};

export const once = <T>(key: string, make: () => T): T => {
  const slot = Symbol.for(`@house-rules/capability/once/${key}`);
  const store = globalThis as unknown as Record<symbol, { value: T } | undefined>;
  // The slot lives on globalThis so a module reload, such as Next dev, finds the first value.
  const held = store[slot] ?? { value: make() };
  store[slot] = held;
  return held.value;
};
