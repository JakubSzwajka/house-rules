import { Identity } from "./facade.js";
import { IdentityOperations } from "./contract.js";
import { bindIdentity } from "./binding/bind-identity.js";
import type { MountDefinition } from "@house-rules/application";
export const IdentityMount = {
  service: Identity,
  operations: Object.values(IdentityOperations),
  bind: bindIdentity,
} satisfies MountDefinition<Identity, Identity["Service"]>;
export { Identity, type Login } from "./facade.js";
export { BindingStore } from "./storage.js";
export {
  Binding,
  BindingInvalid,
  BindingKey,
  BindingTaken,
  IdentityCallerDenied,
  IdentityStoreUnavailable,
} from "./binding/binding.js";
export {
  ActorResolver,
  ForeignIssuer,
  type ActorResolverService,
} from "./sign-in/actor-resolver.js";
export { FirstSignIn, type FirstSignInService } from "./sign-in/first-sign-in.js";
export { type IdentityWhoOptions } from "./sign-in/caller.js";
export { IdentityOperations } from "./contract.js";
export { bindIdentity } from "./binding/bind-identity.js";
export { memoryBindingStore } from "./adapters/memory/binding.js";
export { postgresBindingStore } from "./adapters/postgres/binding.js";
export {
  AccountId,
  AccountInputInvalid,
  DisplayName,
  ChangePasswordInput,
  type ChangePasswordOutcome,
  type AccountPermission,
  AccountPermissions,
  InvalidCredentials,
  SignInInput,
  SignInAnswer,
  type SignInOutcome,
  AccountEmailTaken,
  SignedUp,
  SignUpInput,
  AccountStoreUnavailable,
  SignedIn,
  SignedOut,
} from "./contract.js";
export { memoryAccountStore } from "./adapters/memory/passwords.js";
export { postgresAccountStore } from "./adapters/postgres/passwords.js";
export { type ChangePassword, Lockout } from "./passwords/accounts.js";
export {
  type AdmitCheck,
  AccountStore,
  type FailureCount,
  type FailureLimit,
} from "./passwords/account-store.js";
export {
  PasswordIssuer,
  type PasswordIssuerKeyOptions,
  type PasswordIssuerOptions,
  type PasswordIssuerService,
} from "./passwords/accounts-issuer.js";
export { PasswordIssuerConfigInvalid } from "./passwords/issuer-config-invalid.js";
export { Account } from "./passwords/account.js";
export { PasswordAccountNotFound } from "./passwords/account-lookup.js";
export { PasswordHash, PasswordIterations } from "./passwords/password-hash.js";
export { PasswordsUnavailable } from "./passwords/provider-unavailable.js";
export { DevLocalIssuers } from "./sign-in/dev-local-issuers.js";
export { IdentityProviderInvalid } from "./sign-in/provider-invalid.js";
export type {
  DevLocalProvider,
  IdentityOptions,
  OidcProvider,
  PasswordsProvider,
} from "./sign-in/providers.js";
