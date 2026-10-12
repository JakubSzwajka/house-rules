import { endpoint } from "@house-rules/capability/contract";
import { installed } from "@acme/installed/contract";
import { Effect } from "effect";
import { Schema } from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { HttpClient as Client } from "effect/unstable/http/HttpClient";
import { PersistedQueue } from "effect/unstable/persistence/PersistedQueue";
import { ChildProcess } from "effect/unstable/process";

export const contract = [
  endpoint,
  installed,
  Effect,
  Schema,
  HttpClient,
  Client,
  PersistedQueue,
  ChildProcess,
];
