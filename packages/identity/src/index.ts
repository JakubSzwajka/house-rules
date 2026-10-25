import { Identity } from "./facade.js";
import { IdentityOperations } from "./contract.js";
import { bindIdentity } from "./binding/bind-identity.js";
import type { MountDefinition } from "@house-rules/application";
export const IdentityMount = {
  map: { name: "identity", kind: "package", package: "@house-rules/identity" },
  service: Identity,
  operations: Object.values(IdentityOperations),
  bind: bindIdentity,
} satisfies MountDefinition<Identity, Identity["Service"]>;
export { Identity, type Login } from "./facade.js";
export { ActorStanding, type Standing, type StandingCheck } from "./sign-in/actor-standing.js";
export {
  Credentials,
  type Credential,
  type CredentialKind,
  type AcceptedKind,
} from "./sign-in/credentials.js";
export { ApiTokenStore } from "./api-token/token-store.js";
export { memoryApiTokenStore } from "./adapters/memory/api-token.js";
export { postgresApiTokenStore } from "./adapters/postgres/api-token.js";
export { clerkSessionControl, type ClerkSessionsOptions } from "./adapters/clerk/sessions.js";
export { SessionControl } from "./sessions/session-control.js";
export { SessionControlUnavailable, SessionsPartlyEnded } from "./sessions/sessions.js";
export {
  ApiTokensUnavailable,
  IssueTokenInput,
  IssuedToken,
  RevokedToken,
  TokenId,
  TokenInputInvalid,
  TokenNotFound,
  TokenSummary,
  TokenRow,
  TokenIssued,
  TokenRevoked,
} from "./api-token/api-token.js";
export type { ApiTokensProvider, TokenMethods } from "./api-token/tokens.js";
export { BindingStore, IdentityStoreUnavailable } from "./storage.js";
export {
  Binding,
  BindingInvalid,
  BindingKey,
  BindingTaken,
  IdentityCallerDenied,
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
  ClerkProvider,
  IdentityOptions,
  OidcProvider,
  PasswordsProvider,
} from "./sign-in/providers.js";
