import { type Result, Schema } from "effect";
import type { InvalidCredentials } from "./sign-in.js";
export const ChangePasswordInput = Schema.Struct({ current: Schema.String, next: Schema.String });
export type ChangePasswordInput = typeof ChangePasswordInput.Type;
export type ChangePasswordOutcome = Result.Result<void, InvalidCredentials>;
