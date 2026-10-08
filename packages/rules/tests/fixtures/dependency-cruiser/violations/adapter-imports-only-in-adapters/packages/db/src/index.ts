import { sql } from "effect/unstable/sql";
import { pool } from "./pool/pool.ts";

export const db = [sql, pool];
