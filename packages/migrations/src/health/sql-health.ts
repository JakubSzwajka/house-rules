import { Context, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";

const check = (sql: SqlClient.SqlClient) =>
  sql`SELECT 1`.pipe(Effect.asVoid, Effect.withTracerEnabled(false));

export const SqlHealth = {
  check,
  fromContext: (context: Context.Context<never>) =>
    Option.map(Context.getOption(context, SqlClient.SqlClient), check),
} as const;
