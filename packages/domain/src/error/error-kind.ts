import { Schema } from "effect";

export type ErrorKind = "not_found" | "conflict" | "forbidden" | "unavailable" | "invalid";
export type KindedError = Readonly<{ _tag: string; kind: ErrorKind; message: string }>;

export const errorKind = <const K extends ErrorKind>(kind: K): Schema.tag<K> => Schema.tag(kind);
