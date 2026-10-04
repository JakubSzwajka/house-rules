import type { Permission } from "./permission.ts";

export type PolicyTable<Relation extends string, P extends Permission> = Readonly<
  Record<Relation, Readonly<Record<P, boolean>>>
>;

export type StatefulPolicyTable<
  Relation extends string,
  State extends string,
  P extends Permission,
> = Readonly<Record<Relation, Readonly<Record<State, Readonly<Record<P, boolean>>>>>>;

export type StatefulPolicy<
  Relation extends string,
  State extends string,
  P extends Permission,
> = Readonly<{
  relations: Readonly<Record<Relation, ReadonlyArray<P>>>;
  states: Readonly<Record<State, ReadonlyArray<P>>>;
  permissions: ReadonlyArray<P>;
  allows: (relation: Relation, state: State, permission: P) => boolean;
  table: () => StatefulPolicyTable<Relation, State, P>;
}>;

export type Policy<Relation extends string, P extends Permission> = Readonly<{
  relations: Readonly<Record<Relation, ReadonlyArray<P>>>;
  permissions: ReadonlyArray<P>;
  allows: (relation: Relation, permission: P) => boolean;
  table: () => PolicyTable<Relation, P>;
}>;

export type PolicyBuilder<Relation extends string, P extends Permission> = Policy<Relation, P> &
  Readonly<{
    withStates: <const State extends string>(
      states: Readonly<Record<State, ReadonlyArray<P>>>,
    ) => StatefulPolicy<Relation, State, P>;
  }>;

export const definePolicy = <const Relation extends string, const P extends Permission>(
  relations: Readonly<Record<Relation, ReadonlyArray<P>>>,
): PolicyBuilder<Relation, P> => {
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
  const withStates = <const State extends string>(
    states: Readonly<Record<State, ReadonlyArray<P>>>,
  ): StatefulPolicy<Relation, State, P> => {
    const stateNames = Object.keys(states) as Array<State>;
    const allowsInState = (relation: Relation, state: State, permission: P): boolean =>
      allows(relation, permission) && states[state].includes(permission);
    const statefulTable = (): StatefulPolicyTable<Relation, State, P> =>
      Object.fromEntries(
        names.map((relation) => [
          relation,
          Object.fromEntries(
            stateNames.map((state) => [
              state,
              Object.fromEntries(
                permissions.map((permission) => [
                  permission,
                  allowsInState(relation, state, permission),
                ]),
              ),
            ]),
          ),
        ]),
      ) as StatefulPolicyTable<Relation, State, P>;
    return { relations, states, permissions, allows: allowsInState, table: statefulTable };
  };
  return { relations, permissions, allows, table, withStates };
};
