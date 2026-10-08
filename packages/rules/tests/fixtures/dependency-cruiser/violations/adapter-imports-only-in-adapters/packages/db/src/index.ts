import { sql } from "effect/unstable/sql";
import { pool } from "./pool.ts";

export const db = [sql, pool];
