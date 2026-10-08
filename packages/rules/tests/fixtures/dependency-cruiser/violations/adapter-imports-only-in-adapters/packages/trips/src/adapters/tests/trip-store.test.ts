import { PgClient } from "@effect/sql-pg";
import { postgresTripStore } from "../../index.ts";

export const cases = [PgClient, postgresTripStore];
