import { Context, Effect, Layer, type Scope } from "effect";
import type { NoPerRequest } from "./per-request.ts";

export type ModuleMethod = (
  ...args: ReadonlyArray<never>
) => Effect.Effect<unknown, unknown, never>;

export type ModuleShape<Shape> = { readonly [K in keyof Shape]: ModuleMethod };

export type ModuleClass<Self, Id extends string, Shape> = Context.ServiceClass<Self, Id, Shape> & {
  readonly id: Id;
};

export type ModuleLayer<Self, E, R> = Layer.Layer<Self, E, Exclude<R, Scope.Scope>>;

export interface ModuleDeclaration<Self, Shape> {
  <const Id extends string, E, R>(
    id: Id,
    options: { readonly make: Effect.Effect<Shape, E, R> & NoPerRequest<R> },
  ): ModuleClass<Self, Id, Shape> & {
    readonly make: Effect.Effect<Shape, E, R>;
    readonly layer: ModuleLayer<Self, E, R>;
  };
  <const Id extends string, Options, E, R>(
    id: Id,
    options: {
      readonly make: ((options: Options) => Effect.Effect<Shape, E, R>) & NoPerRequest<R>;
    },
  ): ModuleClass<Self, Id, Shape> & {
    readonly make: (options: Options) => Effect.Effect<Shape, E, R>;
    readonly layer: (options: Options) => ModuleLayer<Self, E, R>;
  };
}

export const defineModule = <Self, Shape extends ModuleShape<Shape>>(): ModuleDeclaration<
  Self,
  Shape
> => {
  function declare<const Id extends string, E, R>(
    id: Id,
    options: { readonly make: Effect.Effect<Shape, E, R> & NoPerRequest<R> },
  ): ModuleClass<Self, Id, Shape> & {
    readonly make: Effect.Effect<Shape, E, R>;
    readonly layer: ModuleLayer<Self, E, R>;
  };
  function declare<const Id extends string, Options, E, R>(
    id: Id,
    options: {
      readonly make: ((options: Options) => Effect.Effect<Shape, E, R>) & NoPerRequest<R>;
    },
  ): ModuleClass<Self, Id, Shape> & {
    readonly make: (options: Options) => Effect.Effect<Shape, E, R>;
    readonly layer: (options: Options) => ModuleLayer<Self, E, R>;
  };
  function declare<const Id extends string, Options, E, R>(
    id: Id,
    options: {
      readonly make:
        | Effect.Effect<Shape, E, R>
        | ((options: Options) => Effect.Effect<Shape, E, R>);
    },
  ) {
    const { make } = options;
    const tag = Context.Service<Self, Shape>()(id);
    const layer = Effect.isEffect(make)
      ? Layer.effect(tag, make)
      : (settings: Options) =>
          Layer.effect(
            tag,
            Effect.suspend(() => make(settings)),
          );
    return class Module extends tag {
      static readonly id = id;
      static readonly make = make;
      static readonly layer = layer;
    };
  }
  return declare;
};
