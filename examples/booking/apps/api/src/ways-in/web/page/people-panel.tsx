import { useState } from "react";
import { ActorId } from "@house-rules/domain/contract";
import { ActionForm } from "./action-form.tsx";
import { useDashboard, useResource, permissionsAt, canAdmin } from "./dashboard.tsx";
import { adminScopes } from "./roles-panel.tsx";
import { DataTable, PageHeading, RowActions, ScopeBadges } from "./screen-kit.tsx";
import { TableCell } from "./components/ui/table.tsx";
import { Select } from "./components/ui/select.tsx";
import { Label } from "./components/ui/label.tsx";
import { Avatar } from "./components/ui/avatar.tsx";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./components/ui/sheet.tsx";
import type { Client } from "./session.ts";
type Person = Awaited<ReturnType<Client["listPeople"]>>[number];
function ManageRoles({ person }: { person: Person }) {
  const dashboard = useDashboard();
  const { client, profile, roles, perform, approve } = dashboard;
  const scopes = adminScopes(dashboard);
  const [scope, setScope] = useState(scopes[0]?.value ?? "global");
  const [roleKey, setRoleKey] = useState("");
  const held = permissionsAt(profile, roles, scope === "global" ? null : scope);
  const available = roles.filter(
    (role) => role.organisationId === null || role.organisationId === scope,
  );
  return (
    <>
      <DataTable
        columns={["Role / scope", "Actions"]}
        rows={person.assignments}
        rowKey={(assignment) => `${assignment.roleKey}-${assignment.organisationId}`}
        empty={<p>No roles assigned yet. Add one below.</p>}
        render={(assignment) => (
          <>
            <TableCell>
              <ScopeBadges items={[assignment]} />
            </TableCell>
            <TableCell>
              <RowActions
                actions={[
                  {
                    label: "Revoke role",
                    destructive: true,
                    reason: canAdmin(profile, roles, assignment.organisationId)
                      ? undefined
                      : "You don't administer this scope",
                    onSelect: () => {
                      approve("revokeRole", () =>
                        client.revokeRole({
                          personId: ActorId.make(person.id),
                          roleKey: assignment.roleKey,
                          organisationId: assignment.organisationId,
                        }),
                      );
                    },
                  },
                ]}
              />
            </TableCell>
          </>
        )}
      />
      <h3 className="font-semibold">Add role</h3>
      <ActionForm
        title="Assign role"
        fields={[]}
        disabled={!roleKey || !scopes.length}
        submit={() => {
          return perform("assignRole", () =>
            client.assignRole({
              personId: ActorId.make(person.id),
              roleKey,
              organisationId: scope === "global" ? null : scope,
            }),
          ).then(() => setRoleKey(""));
        }}
      >
        <div className="grid gap-2">
          <Label>Scope</Label>
          <Select
            name="scope"
            value={scope}
            onValueChange={(value) => {
              setScope(value);
              setRoleKey("");
            }}
            options={scopes}
          />
        </div>
        <div className="grid gap-2">
          <Label>Role</Label>
          <Select
            name="role"
            value={roleKey}
            onValueChange={setRoleKey}
            options={available.map((role) => ({
              value: role.key,
              label: `${role.name}${role.permissions.every((permission) => held.has(permission)) ? "" : " (permissions not held)"}`,
              disabled: !role.permissions.every((permission) => held.has(permission)),
            }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          You can only assign roles whose permissions you hold in this scope.
        </p>
      </ActionForm>
    </>
  );
}
export function PeoplePanel() {
  const { client, epoch } = useDashboard();
  const people = useResource(() => client.listPeople({}), [client, epoch]);
  const [personId, setPersonId] = useState<string | null>(null);
  const person = people.data?.find((row) => row.id === personId);
  return (
    <>
      <PageHeading
        title="People"
        description="People in the organisations you administer, with their scoped roles."
      />
      <DataTable
        columns={["Person", "Roles", "Organisations", "Actions"]}
        rows={people.data ?? []}
        loading={people.loading}
        error={people.error}
        rowKey={(row) => row.id}
        empty={<p>No people in your scope yet. Invite someone from Organisations.</p>}
        render={(row) => (
          <>
            <TableCell className="px-5">
              <div className="flex items-center gap-3">
                <Avatar name={row.displayName} />
                <div>
                  <p className="font-medium">{row.displayName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <ScopeBadges items={row.assignments} />
            </TableCell>
            <TableCell>{row.organisations.map((org) => org.name).join(", ") || "None"}</TableCell>
            <TableCell>
              <RowActions
                actions={[{ label: "Manage roles", onSelect: () => setPersonId(row.id) }]}
              />
            </TableCell>
          </>
        )}
      />
      <Sheet
        open={personId !== null}
        onOpenChange={(open) => {
          if (!open) setPersonId(null);
        }}
      >
        <SheetContent>
          <SheetTitle className="text-xl font-semibold">
            {person?.displayName ?? "Manage roles"}
          </SheetTitle>
          <SheetDescription>Current assignments and access by scope.</SheetDescription>
          {person && <ManageRoles key={person.id} person={person} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
