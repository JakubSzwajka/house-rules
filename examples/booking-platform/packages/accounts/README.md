# @example/accounts

The example app's own sign-in: email and password accounts, and the tokens it signs for them. The app is its own identity provider. An account is credentials only. The profile is a Person in `@house-rules/party`, and the login binding lives in `@house-rules/identity`. Email never links identities. Private, never published.

## What it does

- `Accounts` comes from `defineModule` in `src/facade.ts`. It captures `AccountStore` and `AccountsIssuer`.
- `signUp({ email, password, displayName })` gives `{ accountId, token, expiresAt }`: a new account is signed in at once. It fails with `AccountInputInvalid` or `AccountEmailTaken`.
- `signIn({ email, password })` gives a `SignInOutcome`: `Result<SignedIn, InvalidCredentials>`. `SignedIn` is `{ token, expiresAt }`, with `expiresAt` in epoch milliseconds.
- `changePassword({ accountId, current, next })` gives a `ChangePasswordOutcome`: `Result<void, InvalidCredentials>`. It fails with `AccountInputInvalid` when `next` breaks the policy.
- Every method is a write. It joins the open unit and fails with `NoOpenUnit` outside one.
- `AccountsIssuer` signs ES256 tokens with `jose`. A token has `iss`, `sub` (the account id), `iat`, `exp`, `aud` when configured, and `name` (the display name from sign-up).
- `src/contract.ts` is browser-safe. It holds `signUpContract` (`sign_up`), `signInContract` (`sign_in`), `signOutContract` (`sign_out`) and `changePasswordContract` (`change_password`), with their schemas and errors. `sign_out` is public and does nothing on the server: the app mounts it on a route that clears the session cookie.

## How an app mounts it

1. [ ] Build the issuer in composition. Use `AccountsIssuer.layer({ issuer, audience?, ttlSeconds?, signingKey })` with `signingKey` read as a redacted `ACCOUNTS_SIGNING_KEY`, a private EC P-256 JWK as JSON. `AccountsIssuer.ephemeral({ issuer })` makes a key in memory and logs a warning. Allow it only in development. `AccountsIssuer.newSigningKey` makes a key for `.env.local`.
2. [ ] Mount `Accounts.layerPostgres` (needs `SqlClient`) or `Accounts.layerMemory`, with the issuer layer and the app's unit of work.
3. [ ] Add `{ "workspace": "examples/booking-platform/packages/accounts" }` to `migrations.json`. It owns the `accounts_account` table.
4. [ ] Verify the tokens with `AuthJwt.layer({ issuer: issuer.issuer, audience, jwks: issuer.jwks })` from `@house-rules/auth-jwt`. Its `name` claim feeds `FirstSignIn`.
5. [ ] Write the use-cases:
   - `sign_up` is transactional. Call `Accounts.signUp`.
   - `sign_in` is not transactional. Open the unit around the module call only, then fail after it commits, so a refused attempt still counts:

     ```ts
     const outcome = yield* UnitOfWork.atomic(accounts.signIn(input)).pipe(
       Effect.catchIf(Schema.is(NoOpenUnit), Effect.die),
     );
     return yield* Effect.fromResult(outcome);
     ```

   - `change_password` is not transactional either, and needs `accounts:update`. Open the unit the same way, so a wrong current password counts toward the lock. Resolve the caller's account id first. The account id is the subject of the caller's binding for this issuer, from `Identity.bindingsOf(actor.id)`.
6. [ ] Add views for `AccountInputInvalid`, `AccountEmailTaken`, `InvalidCredentials`, `AccountStoreUnavailable` and `UnitOfWorkFailed`. Map `InvalidCredentials` to one generic `invalid_credentials` answer.

## Fixed rules

- Email is trimmed and lower-cased before it is stored or looked up. It is unique.
- A password has 10 to 200 characters after NFKC normalisation. It is hashed with PBKDF2-SHA256, 600,000 iterations and a 16-byte random salt, through WebCrypto. The record keeps its algorithm, iteration count, salt and hash.
- An unknown email, a wrong password and a locked account all give `InvalidCredentials`, so no answer says an email exists. All three run the same PBKDF2 work and one conditional write; an unknown email uses a dummy hash. The lock is only logged, by account id.
- The hash compare runs over 32 bytes every time, with no branch on the bytes.
- Five failed passwords, through `sign_in` or `change_password`, lock the account for 15 minutes (`Lockout`). A successful sign-in clears the count.
- The lock is checked by the write, not by the account read before the hash. A success clears the count only while the account is unlocked and still has the checked hash, in one statement. A failure adds one and sets the lock in one statement. A lock that lands while a correct password is being checked still wins.
- `PasswordHash` accepts PBKDF2-SHA256 only, so the one upgrade is the iteration count. A sign-in on a record with fewer iterations than the policy rehashes the password at the current count, in the same unit. A record with fewer iterations also pads its work up to the current count, so the work is about equal; equal time is not guaranteed.
- Two sign-ins at once on an old record can refuse one of them: the first rehashes, and the second no longer matches the hash it checked. It fails closed with `InvalidCredentials`; signing in again works.
- A password change does not revoke tokens. A token signed before the change stays valid until it expires, one hour by default (`ttlSeconds`).
- No password appears in an output, an error or a log line. Contract inputs are plain strings, so a decode error never quotes them. The module checks them and fails with fixed messages.
- The issuer sets `iss`, `sub`, `aud`, `iat` and `exp`. Reserved claims from a caller never survive. The public key set never carries `d`. A config error never quotes the key.
- `sign_in` and `change_password` are not transactional, so their contracts declare `UnitOfWorkFailed` themselves. A refusal is a value inside the unit, so the failure count commits before the use-case turns it into the typed error.
- The account keeps the display name from sign-up only so the token's `name` claim can seed the Person on first sign-in.
- The storage port answers facts. `recordFailureIfUnlocked` adds one, or sets the lock and zeroes the count at the limit, in one statement, and answers nothing for a locked or missing account. `admitIfUnlocked` clears the count only for an unlocked account that still has the checked hash. `setPassword` clears both. The limits (lockout, password policy) live in `src/account/`.
