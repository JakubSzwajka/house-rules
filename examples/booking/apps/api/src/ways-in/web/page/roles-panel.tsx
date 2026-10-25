import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionForm, text } from "./action-form.tsx";
import { canAdmin, permissionsAt, useDashboard, type Roles, type Dashboard } from "./dashboard.tsx";
import { DataTable, FormDialog, GuardButton, PageHeading, RowActions } from "./screen-kit.tsx";
import { TableCell } from "./components/ui/table.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Select } from "./components/ui/select.tsx";
import { Tooltip } from "./components/ui/tooltip.tsx";
import { Label } from "./components/ui/label.tsx";
export function adminScopes({
  profile,
  roles,
  organisations,
}: Pick<Dashboard, "profile" | "roles" | "organisations">) {
  return [
    ...(canAdmin(profile, roles, null) ? [{ value: "global", label: "Global" }] : []),
    ...organisations
      .filter((org) => canAdmin(profile, roles, org.id))
      .map((org) => ({ value: org.id, label: org.name })),
  ];
}
export function permissionGroups(permissions: readonly string[]) {
  return [...new Set(permissions.map((permission) => permission.split(":")[0]))].map(
    (resource) => ({
      resource,
      permissions: permissions.filter((permission) => permission.startsWith(`${resource}:`)),
    }),
  );
}
export function roleInput(data: FormData, scope: string, permissions: readonly string[]) {
  return {
    key: text(data, "key"),
    name: text(data, "name"),
    organisationId: scope === "global" ? null : scope,
    permissions: [...permissions],
  };
}
function RoleEditor({ role, done }: { role?: Roles[number] | undefined; done: () => void }) {
  const dashboard = useDashboard();
  const { client, profile, roles, catalogue, perform } = dashboard;
  const scopes = adminScopes(dashboard);
  const [scope, setScope] = useState(role?.organisationId ?? scopes[0]?.value ?? "global");
  const [selected, setSelected] = useState<readonly string[]>(role?.permissions ?? []);
  const held = permissionsAt(profile, roles, scope === "global" ? null : scope);
  return (
    <ActionForm
      title={role ? "Save changes" : "Create role"}
      disabled={catalogue.length === 0 || scopes.length === 0}
      fields={[
        { name: "name", label: "Role name", value: role?.name },
        {
          name: "key",
          label: "Key",
          value: role?.key,
          pattern: "[a-z][a-z0-9-]*",
          hint: "Lowercase letters, numbers and hyphens. Start with a letter.",
          readOnly: !!role,
        },
      ]}
      submit={(data) => {
        if (selected.some((permission) => !held.has(permission)))
          throw new Error("You don't hold every selected permission in this scope.");
        return perform("defineRole", () =>
          client.defineRole(roleInput(data, scope, selected)),
        ).then(done);
      }}
    >
      <div className="grid gap-2">
        <Label>Scope</Label>
        <Select
          name="scope"
          value={scope}
          onValueChange={(value) => {
            setScope(value);
            setSelected([]);
          }}
          options={scopes}
        />
      </div>
      <fieldset className="grid gap-4">
        <legend className="mb-3 text-sm font-medium">Permissions</legend>
        {catalogue.length === 0 && (
          <p className="text-sm text-muted-foreground">
            The permission catalogue is unavailable. Try opening Roles again.
          </p>
        )}
        {permissionGroups(catalogue).map((group) => (
          <div key={group.resource}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.resource}
            </h4>
            <div className="grid gap-2">
              {group.permissions.map((permission) => {
                const checkbox = (
                  <label
                    className={`flex items-center gap-2 text-sm ${held.has(permission) ? "" : "opacity-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(permission)}
                      disabled={!held.has(permission)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, permission]
                            : selected.filter((value) => value !== permission),
                        )
                      }
                    />
                    {permission}
                  </label>
                );
                return (
                  <div key={permission}>
                    {held.has(permission) ? (
                      checkbox
                    ) : (
                      <Tooltip text="You don't hold this permission">{checkbox}</Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>
    </ActionForm>
  );
}
export function RolesPanel() {
  const dashboard = useDashboard();
  const { client, roles, organisations, profile, approve } = dashboard;
  const [editor, setEditor] = useState<Roles[number] | "new" | null>(null);
  const reason =
    adminScopes(dashboard).length === 0 ? "You need administrator access in this scope" : undefined;
  const create = (
    <GuardButton reason={reason} onClick={() => setEditor("new")}>
      <Plus className="size-4" />
      New role
    </GuardButton>
  );
  return (
    <>
      <PageHeading
        title="Roles"
        description="Choose what people can do, globally or in an organisation."
      >
        {create}
      </PageHeading>
      <DataTable
        columns={["Name", "Key", "Scope", "Type", "Permissions", "Actions"]}
        rows={roles}
        rowKey={(role) => role.key}
        empty={
          <>
            <p>No roles yet.</p>
            {create}
          </>
        }
        render={(role) => (
          <>
            <TableCell className="px-5 font-medium">{role.name}</TableCell>
            <TableCell className="font-mono text-xs">{role.key}</TableCell>
            <TableCell>
              {organisations.find((org) => org.id === role.organisationId)?.name ??
                role.organisationId ??
                "Global"}
            </TableCell>
            <TableCell>
              <Badge variant={role.builtIn ? "secondary" : "outline"}>
                {role.builtIn ? "Built-in" : "Custom"}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="grid gap-2">
                {permissionGroups(role.permissions).map((group) => (
                  <div key={group.resource} className="flex flex-wrap gap-1">
                    <span className="mr-1 text-xs text-muted-foreground">{group.resource}</span>
                    {group.permissions.map((permission) => (
                      <Badge key={permission} variant="outline">
                        {permission.split(":")[1]}
                      </Badge>
                    ))}
                  </div>
                ))}
              </div>
            </TableCell>
            <TableCell>
              {!role.builtIn && (
                <RowActions
                  actions={[
                    {
                      label: "Edit",
                      reason: canAdmin(profile, roles, role.organisationId)
                        ? undefined
                        : "You don't administer this scope",
                      onSelect: () => setEditor(role),
                    },
                    {
                      label: "Delete",
                      destructive: true,
                      reason: canAdmin(profile, roles, role.organisationId)
                        ? undefined
                        : "You don't administer this scope",
                      onSelect: () => {
                        approve("deleteRole", () => client.deleteRole({ key: role.key }));
                      },
                    },
                  ]}
                />
              )}
            </TableCell>
          </>
        )}
      />
      <FormDialog
        title={editor === "new" ? "New role" : "Edit role"}
        description="Only permissions you hold in the selected scope can be delegated."
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor && (
          <RoleEditor
            key={editor === "new" ? "new" : editor.key}
            role={editor === "new" ? undefined : editor}
            done={() => setEditor(null)}
          />
        )}
      </FormDialog>
    </>
  );
}
