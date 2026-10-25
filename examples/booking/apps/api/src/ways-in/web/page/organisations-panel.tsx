import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { browserId } from "./browser-id.ts";
import { ActionForm, text } from "./action-form.tsx";
import {
  canAdmin,
  permissionsAt,
  useDashboard,
  useResource,
  type Organisations,
} from "./dashboard.tsx";
import {
  DataTable,
  FormDialog,
  GuardButton,
  PageHeading,
  RowActions,
  ScopeBadges,
} from "./screen-kit.tsx";
import { Button } from "./components/ui/button.tsx";
import { TableCell } from "./components/ui/table.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs.tsx";
import { BookingsPanel } from "./bookings-panel.tsx";
import { CopyButton } from "./copy-button.tsx";
function Members({ org }: { org: Organisations[number] }) {
  const { client, epoch, profile, roles, approve } = useDashboard();
  const admin = canAdmin(profile, roles, org.id);
  const members = useResource(
    () => (admin ? client.listMembers({ organisationId: org.id }) : Promise.resolve([])),
    [client, epoch, org.id, admin],
  );
  if (!admin)
    return (
      <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        Only an organisation administrator can view and manage the member directory.
      </p>
    );
  return (
    <DataTable
      columns={["Member", "Relationship", "Roles", "Actions"]}
      rows={members.data ?? []}
      loading={members.loading}
      error={members.error}
      rowKey={(person) => person.id}
      empty={<p>No members yet. Use Invitations to invite someone.</p>}
      render={(person) => (
        <>
          <TableCell className="px-5 font-medium">{person.displayName}</TableCell>
          <TableCell>{person.relation ?? "Role only"}</TableCell>
          <TableCell>
            <ScopeBadges
              items={person.roles.map((role) => ({
                ...role,
                organisationId: org.id,
                organisationName: org.name,
              }))}
            />
          </TableCell>
          <TableCell>
            <RowActions
              actions={[
                {
                  label: "Remove member",
                  destructive: true,
                  reason:
                    person.relation !== "staff"
                      ? "Only staff relationships can be removed here"
                      : undefined,
                  onSelect: () => {
                    approve("removeMember", () =>
                      client.removeMember({
                        from: { kind: "person", id: person.id },
                        to: { kind: "organisation", id: org.id },
                        kind: "staff",
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
  );
}
function Invitations({ org }: { org: Organisations[number] }) {
  const { client, epoch, profile, roles, perform, approve } = useDashboard();
  const invitations = useResource(
    () => client.listInvitations({ organisationId: org.id }),
    [client, epoch, org.id],
  );
  const [invite, setInvite] = useState(false);
  const [code, setCode] = useState("");
  const held = permissionsAt(profile, roles, org.id);
  const eligible = roles.filter(
    (role) =>
      (role.organisationId === null || role.organisationId === org.id) &&
      role.permissions.every((permission) => held.has(permission)),
  );
  const create = (
    <Button
      onClick={() => {
        setCode("");
        setInvite(true);
      }}
    >
      <Plus className="size-4" />
      Invite
    </Button>
  );
  return (
    <>
      <div className="mb-4 flex justify-end">{create}</div>
      <DataTable
        columns={["Role", "Expires", "Status", "Actions"]}
        rows={(invitations.data ?? []).filter((invitation) => invitation.state === "pending")}
        loading={invitations.loading}
        error={invitations.error}
        rowKey={(invitation) => invitation.id}
        empty={
          <>
            <p>No pending invitations.</p>
            {create}
          </>
        }
        render={(invitation) => (
          <>
            <TableCell className="px-5">
              {roles.find((role) => role.key === invitation.roleKey)?.name ??
                invitation.roleKey ??
                "Staff, no role"}
            </TableCell>
            <TableCell>
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(invitation.expiresAt)}
            </TableCell>
            <TableCell>
              <Badge variant="secondary">
                {invitation.expiresAt < performance.timeOrigin + performance.now()
                  ? "Expired"
                  : "Pending"}
              </Badge>
            </TableCell>
            <TableCell>
              <RowActions
                actions={[
                  {
                    label: "Revoke invitation",
                    destructive: true,
                    onSelect: () => {
                      approve("revokeInvitation", () =>
                        client.revokeInvitation({ id: invitation.id }),
                      );
                    },
                  },
                ]}
              />
            </TableCell>
          </>
        )}
      />
      <FormDialog
        title={code ? "Invitation ready" : "Invite a member"}
        description={
          code
            ? "Copy this one-time code now. It is not shown again."
            : `Invite someone to ${org.name}. Codes expire after seven days.`
        }
        open={invite}
        onOpenChange={setInvite}
      >
        {code ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <code className="min-w-0 flex-1 break-all text-sm">{code}</code>
            <CopyButton value={code} />
          </div>
        ) : (
          <ActionForm
            title="Create invitation"
            fields={[
              {
                name: "roleKey",
                label: "Role",
                value: "none",
                options: [
                  { value: "none", label: "Staff, no role" },
                  ...eligible.map((role) => ({ value: role.key, label: role.name })),
                ],
              },
            ]}
            submit={(data) => {
              return perform("createInvitation", () =>
                client.createInvitation({
                  organisationId: org.id,
                  roleKey: text(data, "roleKey") === "none" ? null : text(data, "roleKey"),
                }),
              ).then((created) => setCode(created.code));
            }}
          />
        )}
      </FormDialog>
    </>
  );
}
export function OrganisationsPanel() {
  const { client, profile, roles, organisations, perform } = useDashboard();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const org = organisations.find((organisation) => organisation.id === selected);
  const create = (
    <GuardButton
      reason={
        profile.access.permissions.includes("party:create-organisation")
          ? undefined
          : "You need party:create-organisation"
      }
      onClick={() => setDialog("create")}
    >
      <Plus className="size-4" />
      New organisation
    </GuardButton>
  );
  return (
    <>
      {org ? (
        <>
          <Button variant="ghost" className="mb-4" onClick={() => setSelected(null)}>
            <ArrowLeft className="size-4" />
            Organisations
          </Button>
          <PageHeading
            title={org.name}
            description={`Your relationship: ${org.relation ?? "role assignment"}`}
          />
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              {canAdmin(profile, roles, org.id) && (
                <TabsTrigger value="invitations">Invitations</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="bookings">
              <BookingsPanel organisationId={org.id} />
            </TabsContent>
            <TabsContent value="members">
              <Members org={org} />
            </TabsContent>
            {canAdmin(profile, roles, org.id) && (
              <TabsContent value="invitations">
                <Invitations org={org} />
              </TabsContent>
            )}
          </Tabs>
        </>
      ) : (
        <>
          <PageHeading title="Organisations" description="Your teams, memberships and invitations.">
            <Button variant="outline" onClick={() => setDialog("join")}>
              Join with code
            </Button>
            {create}
          </PageHeading>
          <DataTable
            columns={["Organisation", "Relationship", "Your roles", "Actions"]}
            rows={organisations}
            rowKey={(organisation) => organisation.id}
            empty={
              <>
                <p>You don't belong to an organisation yet.</p>
                <div className="flex gap-2">
                  {create}
                  <Button variant="outline" onClick={() => setDialog("join")}>
                    Join with code
                  </Button>
                </div>
              </>
            }
            render={(organisation) => (
              <>
                <TableCell className="px-5">
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => setSelected(organisation.id)}
                  >
                    {organisation.name}
                  </button>
                </TableCell>
                <TableCell>{organisation.relation ?? "Role only"}</TableCell>
                <TableCell>
                  <ScopeBadges
                    items={organisation.roles.map((role) => ({
                      ...role,
                      organisationId: organisation.id,
                    }))}
                  />
                </TableCell>
                <TableCell>
                  <RowActions
                    actions={[
                      { label: "View organisation", onSelect: () => setSelected(organisation.id) },
                    ]}
                  />
                </TableCell>
              </>
            )}
          />
        </>
      )}
      <FormDialog
        title={dialog === "create" ? "New organisation" : "Join with code"}
        description={
          dialog === "create"
            ? "You'll become the administrator of your new organisation."
            : "Paste the one-time code shared by an administrator."
        }
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "create" ? (
          <ActionForm
            title="Create organisation"
            fields={[{ name: "name", label: "Organisation name" }]}
            submit={(data) => {
              return perform("createOrganisation", () =>
                client.createOrganisation({ id: browserId(), name: text(data, "name") }),
              ).then((organisation) => {
                setSelected(organisation.id);
                setDialog(null);
              });
            }}
          />
        ) : (
          <ActionForm
            title="Join organisation"
            fields={[{ name: "code", label: "Invitation code" }]}
            submit={(data) => {
              return perform("acceptInvitation", () =>
                client.acceptInvitation({ code: text(data, "code") }),
              ).then((accepted) => {
                setSelected(accepted.organisationId);
                setDialog(null);
              });
            }}
          />
        )}
      </FormDialog>
    </>
  );
}
