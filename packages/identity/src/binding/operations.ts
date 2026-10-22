import { ActorId, defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { PasswordOperations } from "../passwords/operations.js";
import {
  BindingInvalid,
  BindingTaken,
  IdentityCallerDenied,
  IdentityStoreUnavailable,
} from "./binding.js";

const bindLogin = defineOperation("Identity.bindLogin", {
  description: "Bind a verified login to a person during trusted account setup.",
  input: Schema.Struct({ issuer: Schema.String, subject: Schema.String, personId: ActorId }),
  output: ActorId,
  failure: Schema.Union([
    BindingInvalid,
    BindingTaken,
    IdentityCallerDenied,
    IdentityStoreUnavailable,
  ]),
  permission: "identity:bind",
  edges: [],
  transactional: true,
});

export const IdentityOperations = { bindLogin, ...PasswordOperations } as const;
