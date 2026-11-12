import * as Schema from "effect/Schema";

export const OrgId = Schema.String.pipe(Schema.brand("OrgId"));
export type OrgId = typeof OrgId.Type;

export const RoleName = Schema.NonEmptyString;

export const ADMIN_ROLE = "admin";
