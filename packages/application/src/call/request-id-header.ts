export const requestIdHeader = "x-request-id";

const safeRequestId = /^[A-Za-z0-9._:-]{1,128}$/u;

export const requestIdOf = (value: unknown): string | null =>
  typeof value === "string" && safeRequestId.test(value) ? value : null;
