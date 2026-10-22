import { useRef, useState } from "react";
import { Blocks, BookOpen, Fingerprint, ListChecks, ScrollText, Users } from "lucide-react";
import { Schema } from "effect";
import { HttpFailure } from "@house-rules/application/contract";
import { ActorId } from "@house-rules/domain/contract";
import { FrameworkPanel } from "./framework-panel.tsx";
import { api } from "../endpoints.ts";
import { ActionForm, text } from "./action-form.tsx";
import { approvalNeeded, makeClient, type Action, type CallRow, type Client } from "./session.ts";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import { Label } from "./components/ui/label.tsx";
import { CallLog } from "./call-log.tsx";

const menu = [
  { name: "Account", note: "@house-rules/identity · passwords", icon: Fingerprint },
  { name: "Bookings", note: "@example/bookings + @example/billing", icon: BookOpen },
  { name: "People & roles", note: "@house-rules/party", icon: Users },
  { name: "Audit", note: "@house-rules/call-audit", icon: ScrollText },
  { name: "Framework", note: "domain + application + auth-jwt + node-host", icon: Blocks },
  { name: "Call log", note: "Calls made by this tab", icon: ListChecks },
] as const;
type Profile = Awaited<ReturnType<Client["myProfile"]>>;
const email = { name: "email", label: "Email", type: "email" };
const password = { name: "password", label: "Password", type: "password" };
const id = { name: "id", label: "Booking id" };
const scope = { name: "organisationId", label: "Organisation id (blank = global)", optional: true };
const assignment = [
  { name: "personId", label: "Person id" },
  { name: "roleKey", label: "Role key", value: "member" },
  scope,
];
const print = (value: unknown) => JSON.stringify(value, null, 2);

export function App() {
  const [section, setSection] = useState<string>("Account");
  const [rows, setRows] = useState<CallRow[]>([]);
  const last = useRef<CallRow | undefined>(undefined);
  const [client] = useState(() =>
    makeClient((row) => {
      last.current = row;
      setRows((previous) => [row, ...previous]);
    }),
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalogue, setCatalogue] = useState<readonly string[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [problem, setProblem] = useState<CallRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ action: Action; send: () => Promise<unknown> } | null>(
    null,
  );
  const execute = (action: Action, send: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    return send()
      .then((value) => {
        setResult(value ?? { message: "Done" });
        if (Schema.is(Schema.Struct({ _tag: Schema.Literal("InvalidCredentials") }))(value)) {
          const row = {
            ...last.current,
            name: api.endpoints[action].feature.name,
            method: "POST" as const,
            path: `/api/${api.endpoints[action].feature.name}`,
            status: 200,
            ms: last.current?.ms ?? 0,
            code: "InvalidCredentials",
            message: "Invalid credentials.",
          };
          setProblem(row);
          setRows((previous) => [row, ...previous.slice(1)]);
        } else if (action === "signIn" || action === "signUp" || action === "myProfile") {
          return (
            action === "myProfile" ? Promise.resolve(value as Profile) : client.myProfile({})
          ).then((me) => {
            setProfile(me);
            setCatalogue(me.access.catalogue);
          });
        } else if (action === "signOut") setProfile(null);
        else if (action === "listPermissions") setCatalogue(value as readonly string[]);
      })
      .catch((error: unknown) => {
        const failure = Schema.is(HttpFailure)(error) ? error : undefined;
        const payload = failure?.body;
        const body = Schema.is(Schema.Struct({ error: Schema.Unknown }))(payload)
          ? payload.error
          : payload;
        const message =
          Schema.is(Schema.Struct({ message: Schema.String }))(body) && body.message.trim() !== ""
            ? body.message
            : "Request failed.";
        const code = Schema.is(Schema.Struct({ code: Schema.String }))(body)
          ? body.code
          : (failure?.code ?? "Unknown");
        const row: CallRow = {
          ...last.current,
          name: api.endpoints[action].feature.name,
          method: "POST",
          path: `/api/${api.endpoints[action].feature.name}`,
          status: failure?.status ?? 0,
          ms: last.current?.ms ?? 0,
          code,
          message,
        };
        setProblem(row);
        setRows((previous) => [row, ...previous.slice(1)]);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const run = (action: Action, send: () => Promise<unknown>) => {
    if (approvalNeeded(action)) setPending({ action, send });
    else void execute(action, send);
  };
  const form = (
    action: Action,
    title: string,
    fields: Parameters<typeof ActionForm>[0]["fields"],
    send: (data: FormData) => Promise<unknown>,
  ) => (
    <ActionForm
      title={title}
      fields={fields}
      disabled={busy}
      submit={(data) => run(action, () => send(data))}
    />
  );
  const button = (action: Action, label: string, send: () => Promise<unknown>) => (
    <Button variant="outline" disabled={busy} onClick={() => run(action, send)}>
      {label}
    </Button>
  );
  const roleAssignment = (data: FormData) => ({
    personId: ActorId.make(text(data, "personId")),
    roleKey: text(data, "roleKey"),
    organisationId: text(data, "organisationId") || null,
  });

  return (
    <div className="min-h-screen md:flex">
      <aside
        data-slot="sidebar"
        className="border-b bg-sidebar p-4 md:fixed md:inset-y-0 md:w-72 md:border-r"
      >
        <div className="mb-8 flex items-center gap-3 px-2">
          <Blocks className="size-7" />
          <div>
            <h1 className="font-semibold">Booking dashboard</h1>
            <p className="text-xs text-muted-foreground">House rules reference app</p>
          </div>
        </div>
        <nav aria-label="Modules" className="grid gap-1">
          {menu.map(({ name, note, icon: Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => setSection(name)}
              aria-current={section === name ? "page" : undefined}
              className={`flex items-start gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-sidebar-accent ${section === name ? "bg-sidebar-accent" : ""}`}
            >
              <Icon className="mt-1 size-4 shrink-0" />
              <span>
                <span className="block font-medium">{name}</span>
                <span className="block text-xs text-muted-foreground">{note}</span>
              </span>
            </button>
          ))}
        </nav>
        <p className="mt-8 break-all px-3 text-xs text-muted-foreground">
          {profile ? profile.person.displayName : "Not signed in"}
          <br />
          {profile?.person.id}
        </p>
      </aside>
      <main className="min-w-0 flex-1 p-5 md:ml-72 md:p-10">
        <header className="mb-8 border-b pb-5">
          <h2 className="text-2xl font-semibold tracking-tight">{section}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {menu.find((item) => item.name === section)?.note}
          </p>
        </header>
        {problem && (
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>
              {problem.name}: HTTP {problem.status} · {problem.code}
            </AlertTitle>
            <AlertDescription>
              {problem.message}
              <br />
              Request id: {problem.requestId ?? "not returned"}
            </AlertDescription>
          </Alert>
        )}
        {section === "Account" && (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              {form(
                "signUp",
                "Sign up",
                [{ name: "displayName", label: "Display name" }, email, password],
                (data) =>
                  client.signUp({
                    email: text(data, "email"),
                    password: text(data, "password"),
                    displayName: text(data, "displayName"),
                  }),
              )}
              {form("signIn", "Sign in", [email, password], (data) =>
                client.signIn({ email: text(data, "email"), password: text(data, "password") }),
              )}
              {form(
                "changePassword",
                "Change password",
                [
                  { name: "current", label: "Current password", type: "password" },
                  { name: "next", label: "New password", type: "password" },
                ],
                (data) =>
                  client.changePassword({
                    current: text(data, "current"),
                    next: text(data, "next"),
                  }),
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Who am I?</CardTitle>
                  <CardDescription>
                    Person, role assignments and effective permissions from Party.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div className="flex flex-wrap gap-2">
                    {button("myProfile", "Refresh profile", () => client.myProfile({}))}
                    {button("signOut", "Sign out", () => client.signOut({}))}
                  </div>
                  <pre className="overflow-auto text-xs">{print(profile ?? "Sign in first.")}</pre>
                </CardContent>
              </Card>
            </div>
            <Card className="mt-5">
              <CardHeader>
                <CardTitle>Error demos</CardTitle>
                <CardDescription>
                  Use a member account for the define_role refusal. For a hidden booking, copy a
                  real id from another account.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {button("defineRole", "Member: define role (403)", () =>
                  client.defineRole({
                    key: "demo-denied",
                    name: "Demo",
                    permissions: ["party:read"],
                    organisationId: null,
                  }),
                )}
                {button("signUp", "Invalid input (400)", () =>
                  client.signUp({ email: "not-an-email", password: "short", displayName: "" }),
                )}
                {button("signIn", "Wrong password", () =>
                  client.signIn({
                    email: "admin@example.test",
                    password: "deliberately-wrong-password",
                  }),
                )}
              </CardContent>
            </Card>
          </>
        )}
        {section === "Bookings" && (
          <div className="grid gap-5 lg:grid-cols-2">
            {form(
              "makeBooking",
              "Make booking",
              [
                id,
                { name: "guestName", label: "Guest name" },
                { name: "paymentId", label: "Payment id" },
                { name: "amount", label: "Amount (integer)", type: "number", value: "100" },
              ],
              (data) =>
                client.makeBooking({
                  id: text(data, "id"),
                  guestName: text(data, "guestName"),
                  paymentId: text(data, "paymentId"),
                  amount: Number(text(data, "amount")),
                }),
            )}
            <Card>
              <CardHeader>
                <CardTitle>My bookings</CardTitle>
                <CardDescription>
                  Bookings and payment status, joined over published views.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {button("myBookings", "Load my bookings", () => client.myBookings({}))}
              </CardContent>
            </Card>
            {form("showBooking", "Show booking / hidden-id demo", [id], (data) =>
              client.showBooking({ id: text(data, "id") }),
            )}
            {form("cancelBooking", "Cancel booking and refund", [id], (data) =>
              client.cancelBooking({ id: text(data, "id") }),
            )}
          </div>
        )}
        {section === "People & roles" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Roles and permissions</CardTitle>
                <CardDescription>
                  Custom roles respect organisation scope and cannot grant permissions you lack.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-3">
                {button("listRoles", "List roles", () => client.listRoles({}))}
                {button("listPermissions", "Load catalogue", () => client.listPermissions({}))}
              </CardContent>
            </Card>
            <ActionForm
              title="Define custom role"
              disabled={busy}
              fields={[
                { name: "key", label: "Role key" },
                { name: "name", label: "Role name" },
                scope,
              ]}
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
            {form("assignRole", "Assign role", assignment, (data) =>
              client.assignRole(roleAssignment(data)),
            )}
            {form("revokeRole", "Revoke role", assignment, (data) =>
              client.revokeRole(roleAssignment(data)),
            )}
            {form(
              "deleteRole",
              "Delete custom role",
              [{ name: "key", label: "Role key" }],
              (data) => client.deleteRole({ key: text(data, "key") }),
            )}
          </div>
        )}
        {section === "Audit" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent audit</CardTitle>
              <CardDescription>
                Admin-only. Your own latest 50 calls, including refusals. Other people's rows remain
                private.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {button("recentAudit", "Load audit", () => client.recentAudit({}))}
            </CardContent>
          </Card>
        )}
        {section === "Framework" && <FrameworkPanel />}
        {section === "Call log" && <CallLog rows={rows} />}
        {section !== "Framework" && section !== "Call log" && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Last response</CardTitle>
            </CardHeader>
            <CardContent>
              <pre aria-live="polite" className="max-h-96 overflow-auto text-xs">
                {print(result ?? "No call yet.")}
              </pre>
            </CardContent>
          </Card>
        )}
      </main>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Approve {pending ? api.endpoints[pending.action].feature.name : "action"}?
            </DialogTitle>
            <DialogDescription>
              This feature needs your approval. Confirming sends the request. Cancel sends nothing.
              Permission and object checks still run on the server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pending) {
                  const approved = pending;
                  setPending(null);
                  void execute(approved.action, approved.send);
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
