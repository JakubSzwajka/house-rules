import { SqlClient } from "effect/unstable/sql/SqlClient";
import { PgClient } from "@effect/sql-pg";

export const postgresTripStore = [SqlClient, PgClient];
