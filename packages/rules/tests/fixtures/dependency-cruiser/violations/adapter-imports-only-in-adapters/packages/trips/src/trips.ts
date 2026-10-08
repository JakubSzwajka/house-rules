import { SqlClient } from "effect/unstable/sql/SqlClient";
import { Effect } from "effect";

export const listTrips = Effect.succeed(SqlClient);
