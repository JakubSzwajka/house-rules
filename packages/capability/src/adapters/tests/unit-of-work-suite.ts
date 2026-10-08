import { layer, type Vitest } from "@effect/vitest";
import type { UnitOfWork } from "../../index.ts";
import type { Opens, Stores } from "./unit-of-work-fixtures.ts";
import { memoryWorld, sqlWorld } from "./unit-of-work-fixtures.ts";

const options = { excludeTestServices: true, timeout: "30 seconds" } as const;

export const onBothAdapters = (
  name: string,
  cases: (it: Vitest.MethodsNonLive<UnitOfWork | Stores | Opens>) => void,
) => {
  layer(memoryWorld, options)(`${name}, memory adapter`, cases);
  layer(sqlWorld, options)(`${name}, sql adapter on Postgres`, cases);
};
