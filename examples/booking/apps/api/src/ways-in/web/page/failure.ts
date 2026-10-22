import { Schema } from "effect";
import { HttpFailure } from "@house-rules/application/contract";
export function failureDetail(error: unknown) {
  const failure = Schema.is(HttpFailure)(error) ? error : undefined;
  const payload = failure?.body;
  const body = Schema.is(Schema.Struct({ error: Schema.Unknown }))(payload)
    ? payload.error
    : payload;
  const message =
    Schema.is(Schema.Struct({ message: Schema.String }))(body) && body.message.trim() !== ""
      ? body.message
      : "Request failed. Please try again.";
  const code = Schema.is(Schema.Struct({ code: Schema.String }))(body)
    ? body.code
    : (failure?.code ?? "Unknown");
  return { message, code, status: failure?.status ?? 0 };
}
