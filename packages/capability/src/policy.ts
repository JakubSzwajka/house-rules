import type { Permission } from "./permission.ts";

export type PolicyTable<Relation extends string, P extends Permission> = Readonly<
  Record<Relation, Readonly<Record<P, boolean>>>
>;

export type Policy<Relation extends string, P extends Permission> = Readonly<{
  relations: Readonly<Record<Relation, ReadonlyArray<P>>>;
  permissions: ReadonlyArray<P>;
  allows: (relation: Relation, permission: P) => boolean;
  table: () => PolicyTable<Relation, P>;
}>;

export const definePolicy = <const Relation extends string, const P extends Permission>(
  relations: Readonly<Record<Relation, ReadonlyArray<P>>>,
): Policy<Relation, P> => {
  const names = Object.keys(relations) as Array<Relation>;
  const permissions = [...new Set(names.flatMap((relation) => relations[relation]))];
  const allows = (relation: Relation, permission: P): boolean =>
    relations[relation].includes(permission);
  const table = (): PolicyTable<Relation, P> =>
    Object.fromEntries(
      names.map((relation) => [
        relation,
        Object.fromEntries(
          permissions.map((permission) => [permission, allows(relation, permission)]),
        ),
      ]),
    ) as PolicyTable<Relation, P>;
  return { relations, permissions, allows, table };
};
