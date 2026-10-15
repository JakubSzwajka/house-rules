import { defineContract } from "@house-rules/application/contract";
import { UnitOfWorkFailed } from "@house-rules/domain/contract";
import { type Result, Schema } from "effect";
import { AccountInputInvalid } from "./account.js";
import { AccountPermissions } from "./permissions.js";
import { InvalidCredentials } from "./sign-in.js";
import { AccountStoreUnavailable } from "./store-unavailable.js";

export const ChangePasswordInput = Schema.Struct({ current: Schema.String, next: Schema.String });
export type ChangePasswordInput = typeof ChangePasswordInput.Type;

export type ChangePasswordOutcome = Result.Result<void, InvalidCredentials>;

export const changePasswordContract = defineContract("change_password", {
  description: "Change your own password. Needs the current one.",
  input: ChangePasswordInput,
  output: Schema.Struct({}),
  failure: Schema.Union([
    InvalidCredentials,
    AccountInputInvalid,
    AccountStoreUnavailable,
    UnitOfWorkFailed,
  ]),
  permission: AccountPermissions.update,
});
