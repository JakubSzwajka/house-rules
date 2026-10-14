export const PerRequest: unique symbol = Symbol.for("@house-rules/domain/PerRequest");

export interface PerRequest {
  readonly [PerRequest]: typeof PerRequest;
}

export type NoPerRequest<R> = [Extract<R, PerRequest>] extends [never]
  ? unknown
  : {
      readonly "defineModule: make cannot capture a per-request service; take its value as a method argument": never;
    };
