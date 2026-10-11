import { Schema } from "effect";

export class MigrationFailed extends Schema.TaggedError<MigrationFailed>()("MigrationFailed", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class UnsafeTestDatabase extends Schema.TaggedError<UnsafeTestDatabase>()(
  "UnsafeTestDatabase",
  { message: Schema.String },
) {}

export type MigrationAdoption = Readonly<{
  from: string;
  ids: ReadonlyArray<number>;
  rehash?: ReadonlyArray<number>;
}>;

export type MigrationModule = Readonly<{
  name: string;
  directory: string;
  table: string;
  adopt?: MigrationAdoption;
}>;

export type AppliedMigration = Readonly<{
  id: number;
  name: string;
}>;

export type AdoptionReport = Readonly<{
  from: string;
  adopted: ReadonlyArray<AppliedMigration>;
  rehashed: ReadonlyArray<AppliedMigration>;
}>;

export type ModuleReport = Readonly<{
  module: string;
  table: string;
  adoption?: AdoptionReport;
  verified: ReadonlyArray<AppliedMigration>;
  backfilled: ReadonlyArray<AppliedMigration>;
  applied: ReadonlyArray<AppliedMigration>;
}>;

export type MigrationReport = ReadonlyArray<ModuleReport>;
