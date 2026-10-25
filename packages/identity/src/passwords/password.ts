import { Effect, Result } from "effect";
import { Base64 } from "effect/encoding";
import { PasswordAlgorithm, type PasswordHash, PasswordIterations } from "./password-hash.js";

const saltBytes = 16;
const hashBits = 256;

export const PasswordLength = { min: 10, max: 200 } as const;

const normalised = (password: string) =>
  // NIST SP 800-63B: the same password typed on two keyboards hashes the same.
  password.normalize("NFKC");

export const passwordFitsPolicy = (password: string) => {
  const length = [...normalised(password)].length;
  return length >= PasswordLength.min && length <= PasswordLength.max;
};

const derive = (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) =>
  Effect.promise(() =>
    globalThis.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(normalised(password)),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
  ).pipe(
    Effect.flatMap((key) =>
      Effect.promise(() =>
        globalThis.crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt, iterations },
          key,
          hashBits,
        ),
      ),
    ),
    Effect.map((bits) => new Uint8Array(bits)),
  );

const hashBytes = hashBits / 8;

const fixedLength = (bytes: Uint8Array) => {
  const fixed = new Uint8Array(hashBytes);
  fixed.set(bytes.subarray(0, hashBytes));
  return new DataView(fixed.buffer);
};

const sameBytes = (left: Uint8Array, right: Uint8Array) => {
  // Fixed length and no branch on the bytes, so the time taken does not say how much matched.
  const [a, b] = [fixedLength(left), fixedLength(right)];
  let difference = (left.length ^ hashBytes) | (right.length ^ hashBytes);
  for (let index = 0; index < hashBytes; index += 1) {
    difference |= a.getUint8(index) ^ b.getUint8(index);
  }
  return difference === 0;
};

const bytesOf = (text: string) =>
  Result.match(Base64.decode(text), {
    onFailure: () => undefined,
    onSuccess: (bytes) => new Uint8Array(bytes),
  });

export const hashPassword = Effect.fn("Password.hash")(function* (password: string) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(saltBytes));
  const hash = yield* derive(password, salt, PasswordIterations);
  const record: PasswordHash = {
    algorithm: PasswordAlgorithm,
    iterations: PasswordIterations,
    salt: Base64.encode(salt),
    hash: Base64.encode(hash),
  };
  return record;
});

const dummyHash: PasswordHash = {
  algorithm: PasswordAlgorithm,
  iterations: PasswordIterations,
  salt: Base64.encode(new Uint8Array(saltBytes)),
  hash: Base64.encode(new Uint8Array(hashBytes)),
};

export const needsRehash = (record: PasswordHash) =>
  record.algorithm !== PasswordAlgorithm || record.iterations < PasswordIterations;

const padToPolicy = (password: string, iterations: number) =>
  // A legacy record verifies at the current cost, so its timing does not mark it as old.
  iterations < PasswordIterations
    ? derive(password, new Uint8Array(saltBytes), PasswordIterations - iterations)
    : Effect.void;

export const verifyPassword = Effect.fn("Password.verify")(function* (
  password: string,
  record: PasswordHash,
) {
  const salt = bytesOf(record.salt);
  const expected = bytesOf(record.hash);
  if (salt === undefined || expected === undefined) {
    yield* derive(password, new Uint8Array(saltBytes), PasswordIterations);
    return false;
  }
  const matches = sameBytes(yield* derive(password, salt, record.iterations), expected);
  yield* padToPolicy(password, record.iterations);
  return matches;
});

export const spendDummyWork = (password: string) =>
  // A sign-in with no account does the same work, so its timing does not reveal the email.
  verifyPassword(password, dummyHash).pipe(Effect.as(false));
