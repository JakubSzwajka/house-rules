import { Crypto, Effect, Encoding, FileSystem, Path } from "effect";

export type Tree = Readonly<Record<string, string>>;

export const ALPHA_ITEM = `create table alpha_item (id integer primary key);
--> statement-breakpoint
insert into alpha_item (id) values (1);
`;
export const ALPHA_NOTE = "alter table alpha_item add column note text;\n";
export const BETA_ENTRY = "create table beta_entry (id integer primary key);\n";
export const TRIPS_ITEM = "create table trips_item (id integer primary key);\n";
export const TRIPS_NOTE = "alter table trips_item add column note text;\n";

export const alphaAndBeta: Tree = {
  "migrations.json": JSON.stringify({
    modules: [{ workspace: "packages/alpha" }, { package: "@vendor/beta" }],
  }),
  "packages/alpha/package.json": JSON.stringify({ name: "@app/alpha" }),
  "packages/alpha/migrations/0001_alpha_item.sql": ALPHA_ITEM,
  "packages/alpha/migrations/0002_alpha_note.sql": ALPHA_NOTE,
  "node_modules/@vendor/beta/package.json": JSON.stringify({
    name: "@vendor/beta",
    houseRules: { migrations: "sql" },
  }),
  "node_modules/@vendor/beta/sql/0001_beta_entry.sql": BETA_ENTRY,
};

export const scratchApp = Effect.fnUntraced(function* scratchApp(tree: Tree) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "house-rules-migrations-" });
  const write = Effect.fnUntraced(function* write(file: string, text: string) {
    const target = path.join(root, file);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, text);
  });
  for (const [file, text] of Object.entries(tree)) {
    yield* write(file, text);
  }
  return {
    list: path.join(root, "migrations.json"),
    write,
    digest: Effect.fnUntraced(function* digest(file: string) {
      const bytes = yield* fs.readFile(path.join(root, file));
      return Encoding.encodeHex(
        yield* Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", bytes)),
      );
    }),
  };
});
