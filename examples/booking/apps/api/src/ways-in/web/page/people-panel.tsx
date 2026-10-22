import { ActorId } from "@house-rules/domain/contract";
import { ActionForm, text } from "./action-form.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import { Label } from "./components/ui/label.tsx";
import type { Action, Client } from "./session.ts";
const scope = { name: "organisationId", label: "Organisation id (blank = global)", optional: true };
export function PeoplePanel({
  client,
  busy,
  run,
  people,
  catalogue,
}: {
  client: Client;
  busy: boolean;
  run: (action: Action, send: () => Promise<unknown>) => void;
  people: Awaited<ReturnType<Client["listPeople"]>>;
  catalogue: readonly string[];
}) {
  const assignment = [
    {
      name: "personId",
      label: "Person",
      options: people.map((p) => ({ value: p.id, label: `${p.displayName} (${p.id})` })),
    },
    { name: "roleKey", label: "Role key", value: "member" },
    scope,
  ];
  const roleAssignment = (data: FormData) => ({
    personId: ActorId.make(text(data, "personId")),
    roleKey: text(data, "roleKey"),
    organisationId: text(data, "organisationId") || null,
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Roles and permissions</CardTitle>
          <CardDescription>
            Custom roles respect organisation scope and cannot grant permissions you lack. Load
            people before assigning a role.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run("listPeople", () => client.listPeople({}))}
          >
            Load people for picker
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run("listRoles", () => client.listRoles({}))}
          >
            List roles
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run("listPermissions", () => client.listPermissions({}))}
          >
            Load catalogue
          </Button>
        </CardContent>
      </Card>
      <ActionForm
        title="Define custom role"
        disabled={busy}
        fields={[{ name: "key", label: "Role key" }, { name: "name", label: "Role name" }, scope]}
        submit={(data) =>
          run("defineRole", () =>
            client.defineRole({
              key: text(data, "key"),
              name: text(data, "name"),
              organisationId: text(data, "organisationId") || null,
              permissions: data.getAll("permission").map(String),
            }),
          )
        }
      >
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Permissions from app catalogue</legend>
          {catalogue.map((permission) => (
            <Label key={permission} className="flex items-center gap-2">
              <input type="checkbox" name="permission" value={permission} />
              {permission}
            </Label>
          ))}
          {catalogue.length === 0 && (
            <p className="text-sm text-muted-foreground">Load the catalogue first.</p>
          )}
        </fieldset>
      </ActionForm>
      <ActionForm
        title="Assign role"
        disabled={busy || people.length === 0}
        fields={assignment}
        submit={(data) => run("assignRole", () => client.assignRole(roleAssignment(data)))}
      />
      <ActionForm
        title="Revoke role"
        disabled={busy || people.length === 0}
        fields={assignment}
        submit={(data) => run("revokeRole", () => client.revokeRole(roleAssignment(data)))}
      />
      <ActionForm
        title="Delete custom role"
        disabled={busy}
        fields={[{ name: "key", label: "Role key" }]}
        submit={(data) => run("deleteRole", () => client.deleteRole({ key: text(data, "key") }))}
      />
    </div>
  );
}
