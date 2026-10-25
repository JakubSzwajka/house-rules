import { createContext, useContext, useEffect, useRef, useState } from "react";
import { failureDetail } from "./failure.ts";
import type { Action, Client } from "./session.ts";
import type { CallRow } from "./session.ts";
export type Profile = Awaited<ReturnType<Client["myProfile"]>>;
export type Roles = Awaited<ReturnType<Client["listRoles"]>>;
export type Organisations = Awaited<ReturnType<Client["myOrganisations"]>>;
export type Dashboard = {
  client: Client;
  profile: Profile;
  roles: Roles;
  organisations: Organisations;
  catalogue: readonly string[];
  epoch: number;
  perform: <T>(action: Action, send: () => Promise<T>) => Promise<T>;
  approve: (action: Action, send: () => Promise<unknown>) => void;
  report: (error: unknown) => void;
};
export const DashboardContext = createContext<Dashboard | null>(null);
export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("Dashboard must be mounted inside the signed-in app.");
  return context;
}
export function useResource<T>(load: () => Promise<T>, dependencies: readonly unknown[]) {
  const context = useContext(DashboardContext);
  const report = useRef(context?.report);
  report.current = context?.report;
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true }));
    void load()
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (active) {
          report.current?.(error);
          setState({ error: failureDetail(error).message, loading: false });
        }
      });
    return () => {
      active = false;
    };
  }, dependencies);
  return state;
}
export function permissionsAt(profile: Profile, roles: Roles, scope: string | null) {
  return new Set(
    profile.access.roles
      .filter(
        (assignment) => assignment.organisationId === null || assignment.organisationId === scope,
      )
      .flatMap(
        (assignment) => roles.find((role) => role.key === assignment.roleKey)?.permissions ?? [],
      ),
  );
}
export function canAdmin(profile: Profile, roles: Roles, scope: string | null) {
  return (
    profile.access.permissions.includes("party:admin") &&
    permissionsAt(profile, roles, scope).has("party:admin")
  );
}
export function roleOptions(client: Pick<Client, "listPermissions" | "listRoles">) {
  // Fetch both on entry. A permission picker must never depend on a previous manual call.
  return Promise.all([client.listPermissions({}), client.listRoles({})]).then(
    ([catalogue, roles]) => ({ catalogue, roles }),
  );
}
export type RowAction = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  reason?: string | undefined;
};
export type Notice = CallRow & { toastId: number };
