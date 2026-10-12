import { Effect, Stream } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";
import { Refused } from "./caller.ts";
import { fieldName, InputInvalid } from "./input.ts";

export const givenTwice = (key: string): InputInvalid =>
  new InputInvalid({ field: fieldName(key), message: `Give ${fieldName(key)} once.` });

const tooLarge = (limit: number): Refused =>
  new Refused({
    status: 413,
    code: "body_too_large",
    message: `The body is larger than ${limit} bytes.`,
  });

const unreadable = new InputInvalid({ field: "body", message: "The body could not be read." });

export const readCapped = (
  request: HttpServerRequest.HttpServerRequest,
  web: Request,
  limit: number,
): Effect.Effect<string, InputInvalid | Refused> =>
  Effect.gen(function* readBody() {
    const declared = Number(web.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > limit) return yield* tooLarge(limit);
    if (web.body === null) return "";
    const chunks = yield* request.stream.pipe(
      Stream.mapError(() => unreadable),
      Stream.runFoldEffect(
        () => ({ chunks: [] as Array<Uint8Array>, total: 0 }),
        (read, chunk: Uint8Array) => {
          read.total += chunk.byteLength;
          // Failing here ends the stream, which cancels the reader before the rest arrives.
          if (read.total > limit) return Effect.fail(tooLarge(limit));
          read.chunks.push(chunk);
          return Effect.succeed(read);
        },
      ),
    );
    const bytes = new Uint8Array(chunks.total);
    let offset = 0;
    for (const chunk of chunks.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  });

const repeatedMember = (text: string): string | undefined => {
  // JSON.parse keeps the last of two equal names, so scan the already valid text for a repeat.
  const objects: Array<Set<string> | undefined> = [];
  let expectKey = false;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === '"') {
      let end = at + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const keys = objects.at(-1);
      if (expectKey && keys !== undefined) {
        const key = JSON.parse(text.slice(at, end + 1)) as string;
        if (keys.has(key)) return key;
        keys.add(key);
        expectKey = false;
      }
      at = end;
    } else if (char === "{") {
      objects.push(new Set());
      expectKey = true;
    } else if (char === "[") {
      objects.push(undefined);
      expectKey = false;
    } else if (char === "}" || char === "]") {
      objects.pop();
    } else if (char === ",") {
      expectKey = objects.at(-1) !== undefined;
    }
  }
  return undefined;
};

export const parseObject = (text: string): Effect.Effect<Record<string, unknown>, InputInvalid> => {
  if (text.trim() === "") return Effect.succeed({});
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new InputInvalid({ field: "body", message: "The body is not valid JSON." }),
  }).pipe(
    Effect.filterOrFail(
      (body): body is Record<string, unknown> =>
        typeof body === "object" && body !== null && !Array.isArray(body),
      () => new InputInvalid({ field: "body", message: "The body must be a JSON object." }),
    ),
    Effect.flatMap((body) => {
      const repeated = repeatedMember(text);
      return repeated === undefined ? Effect.succeed(body) : Effect.fail(givenTwice(repeated));
    }),
  );
};
