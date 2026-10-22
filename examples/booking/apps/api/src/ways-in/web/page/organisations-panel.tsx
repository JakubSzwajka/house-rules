import { ActionForm, text } from "./action-form.tsx";
import { Button } from "./components/ui/button.tsx";
import type { Action, Client } from "./session.ts";

export function OrganisationsPanel({
  client,
  busy,
  run,
  people,
}: {
  client: Client;
  busy: boolean;
  run: (action: Action, send: () => Promise<unknown>) => void;
  people: Awaited<ReturnType<Client["listPeople"]>>;
}) {
  const org = { name: "organisationId", label: "Organisation id" };
  const person = {
    name: "personId",
    label: "Member",
    options: people.map((p) => ({ value: p.id, label: `${p.displayName} (${p.id})` })),
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => run("myOrganisations", () => client.myOrganisations({}))}
        >
          My organisations
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => run("listPeople", () => client.listPeople({}))}
        >
          Load members for picker
        </Button>
        <p className="text-sm text-muted-foreground">
          Create an organisation as a member, or accept a code from its administrator. An invitation
          may omit a role. An org admin cannot delegate the global member role's booking permissions
          unless they hold them in that scope.
        </p>
      </div>
      <ActionForm
        title="Create organisation"
        disabled={busy}
        fields={[
          { name: "id", label: "New organisation id" },
          { name: "name", label: "Name" },
        ]}
        submit={(data) =>
          run("createOrganisation", () =>
            client.createOrganisation({ id: text(data, "id"), name: text(data, "name") }),
          )
        }
      />
      <ActionForm
        title="Create invitation"
        disabled={busy}
        fields={[org, { name: "roleKey", label: "Role key (optional)", optional: true }]}
        submit={(data) =>
          run("createInvitation", () =>
            client.createInvitation({
              organisationId: text(data, "organisationId"),
              roleKey: text(data, "roleKey") || null,
            }),
          )
        }
      />
      <ActionForm
        title="Accept invitation"
        disabled={busy}
        fields={[{ name: "code", label: "One-time code" }]}
        submit={(data) =>
          run("acceptInvitation", () => client.acceptInvitation({ code: text(data, "code") }))
        }
      />
      <ActionForm
        title="List invitations"
        disabled={busy}
        fields={[org]}
        submit={(data) =>
          run("listInvitations", () =>
            client.listInvitations({ organisationId: text(data, "organisationId") }),
          )
        }
      />
      <ActionForm
        title="Revoke invitation"
        disabled={busy}
        fields={[{ name: "id", label: "Invitation id" }]}
        submit={(data) =>
          run("revokeInvitation", () => client.revokeInvitation({ id: text(data, "id") }))
        }
      />
      <ActionForm
        title="Remove member"
        disabled={busy || people.length === 0}
        fields={[org, person]}
        submit={(data) =>
          run("removeMember", () =>
            client.removeMember({
              from: { kind: "person", id: text(data, "personId") },
              to: { kind: "organisation", id: text(data, "organisationId") },
              kind: "staff",
            }),
          )
        }
      />
    </div>
  );
}
