import { CREATE_TABLE, foreignKeyReferences, tableName, tableReferences } from "./sql-text.mjs";
import { viewQueryProblems } from "./sql-views.mjs";

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

export const migrationOwnership = (migrations, report) => {
  migrations.sort((a, b) => a.file.localeCompare(b.file));
  const owners = new Map();
  const views = new Set();
  for (const { file, owner, sql, ddl } of migrations) {
    for (const problem of ddl.problems) report(file, 1, problem);
    const objects = [
      ...[...sql.matchAll(CREATE_TABLE)].map((match) => ({
        name: tableName(match[1]),
        index: match.index,
      })),
      ...ddl.objects,
    ];
    for (const { name: table, index } of objects) {
      if (ddl.objects.some((view) => view.name === table)) views.add(table);
      const creators = owners.get(table) ?? [];
      if (creators.length > 0 && !creators.includes(owner))
        report(
          file,
          lineAt(sql, index),
          `table "${table}" is already created by ${creators[0]}. A table has one owning package.`,
        );
      if (!creators.includes(owner)) owners.set(table, [...creators, owner]);
    }
  }
  const foreignOwner = (table, owner) => {
    const creators = owners.get(tableName(table));
    return creators !== undefined && !creators.includes(owner) ? creators[0] : undefined;
  };
  for (const { file, owner, sql, ddl } of migrations) {
    const allowed = new Set(
      [...owners].filter(([, creators]) => creators.includes(owner)).map(([name]) => name),
    );
    for (const view of ddl.objects)
      for (const problem of viewQueryProblems(view, allowed))
        report(
          file,
          lineAt(sql, view.index),
          `view names unknown object or unsupported SQL: ${problem}`,
        );
    for (const change of ddl.changes) {
      if (
        !allowed.has(change.name) &&
        !tableReferences(sql).some(
          ({ name }) => tableName(name) === change.name && foreignOwner(name, owner),
        )
      )
        report(
          file,
          lineAt(sql, change.index),
          `ALTER/DROP touches "${change.name}", not this module's own table or view.`,
        );
    }
    let references;
    try {
      references = foreignKeyReferences(sql);
    } catch (error) {
      report(file, 1, `cannot read migration SQL: ${error.message}.`);
      references = [];
    }
    for (const { name, index } of references) {
      const other = foreignOwner(name, owner);
      if (other !== undefined)
        report(
          file,
          lineAt(sql, index),
          `foreign key to "${tableName(name)}", a table ${other} owns. No cross-module foreign keys: keep the id as a plain column and ask ${other}'s service for the record.`,
        );
    }
    for (const { name, index } of tableReferences(sql)) {
      const other = foreignOwner(name, owner);
      if (other !== undefined)
        report(
          file,
          lineAt(sql, index),
          `touches "${tableName(name)}", a table ${other} owns. A migration changes only its own package's tables.`,
        );
    }
  }
  return { owners, views, foreignOwner };
};
