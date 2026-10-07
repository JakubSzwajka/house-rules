import { Schema } from "effect";

export class MigrationFailed extends Schema.TaggedError<MigrationFailed>()("MigrationFailed", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class UnsafeTestDatabase extends Schema.TaggedError<UnsafeTestDatabase>()(
  "UnsafeTestDatabase",
  { message: Schema.String },
) {}

export type MigrationModule = Readonly<{
  name: string;
  directory: string;
  table: string;
}>;

export type AppliedMigration = Readonly<{
  id: number;
  name: string;
}>;

export type ModuleReport = Readonly<{
  module: string;
  table: string;
  verified: ReadonlyArray<AppliedMigration>;
  backfilled: ReadonlyArray<AppliedMigration>;
  applied: ReadonlyArray<AppliedMigration>;
}>;

export type MigrationReport = ReadonlyArray<ModuleReport>;
