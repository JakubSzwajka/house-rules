import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronsUpDown, LogOut } from "lucide-react";
import { menu, route } from "./navigation.ts";
import { Schema } from "effect";
import { api } from "../endpoints.ts";
import {
  approvalNeeded,
  clearsCallHistory,
  makeClient,
  type Action,
  type CallRow,
} from "./session.ts";
import {
  DashboardContext,
  roleOptions,
  useResource,
  type Notice,
  type Profile,
} from "./dashboard.tsx";
import { failureDetail } from "./failure.ts";
import { AuthPanel } from "./auth-panel.tsx";
import { OverviewPanel } from "./overview-panel.tsx";
import { BookingsPanel } from "./bookings-panel.tsx";
import { OrganisationsPanel } from "./organisations-panel.tsx";
import { PeoplePanel } from "./people-panel.tsx";
import { RolesPanel } from "./roles-panel.tsx";
import { AuditPanel } from "./audit-panel.tsx";
import { FrameworkPanel } from "./framework-panel.tsx";
import { AuditDock } from "./audit-dock.tsx";
import { ActionForm } from "./action-form.tsx";
import { FormDialog, ScopeBadges } from "./screen-kit.tsx";
import { Button } from "./components/ui/button.tsx";
import { Avatar } from "./components/ui/avatar.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { TooltipProvider } from "./components/ui/tooltip.tsx";
import { ToastProvider, Toasts } from "./components/ui/toast.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.tsx";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/ui/alert-dialog.tsx";
export function App() {
  const [section, setSection] = useState(route);
  const [rows, setRows] = useState<CallRow[]>([]);
  const reports = useRef(new Map<string, CallRow>());
  const lastFailure = useRef<CallRow | undefined>(undefined);
  const [client] = useState(() =>
    makeClient((row) => {
      reports.current.set(row.name, row);
      if (row.status >= 400) lastFailure.current = row;
      setRows((previous) => [row, ...previous].slice(0, 200));
    }),
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const [password, setPassword] = useState(false);
  const [pending, setPending] = useState<{
    action: Action;
    send: () => Promise<unknown>;
  } | null>(null);
  const options = useResource(
    () =>
      profile
        ? Promise.all([roleOptions(client), client.myOrganisations({})]).then(
            ([access, organisations]) => ({
              ...access,
              organisations,
              personId: profile.person.id,
            }),
          )
        : Promise.resolve(null),
    [client, profile?.person.id, epoch, section],
  );
  useEffect(() => {
    const change = () => setSection(route());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let active = true;
    void client
      .myProfile({})
      .then((me) => {
        if (active) setProfile(me);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setRows([]);
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [client]);
  const notify = (row: CallRow) =>
    setNotices((previous) => [...previous, { ...row, toastId: ++noticeId.current }].slice(-5));
  const perform = <T,>(action: Action, send: () => Promise<T>): Promise<T> => {
    const name = api.endpoints[action].feature.name;
    return send()
      .then((value) => {
        const report = reports.current.get(name);
        if (Schema.is(Schema.TaggedStruct("InvalidCredentials", {}))(value)) {
          const row = {
            ...report,
            name,
            method: "POST" as const,
            path: `/api/${name}`,
            status: 200,
            ms: report?.ms ?? 0,
            code: "InvalidCredentials",
            message: "The email or password is incorrect.",
          };
          notify(row);
          setRows((previous) => [
            row,
            ...previous.filter((item) => item.requestId !== row.requestId),
          ]);
          throw new Error(row.message);
        }
        const refresh =
          action === "signOut"
            ? Promise.resolve().then(() => {
                setProfile(null);
                setRows([]);
                reports.current.clear();
                setNotices([]);
              })
            : api.endpoints[action].feature.readOnly
              ? Promise.resolve()
              : client.myProfile({}).then((me) => {
                  if (clearsCallHistory(action, profile?.person.id, me.person.id)) {
                    setRows([]);
                    reports.current.clear();
                    setNotices([]);
                  }
                  setProfile(me);
                  setEpoch((previous) => previous + 1);
                  if (action === "signIn" || action === "signUp") window.location.hash = "overview";
                });
        return refresh.then(() => {
          if (report) notify({ ...report, message: `${name.replaceAll("_", " ")} completed.` });
          return value;
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "The email or password is incorrect.")
          throw error;
        const detail = failureDetail(error);
        const report = reports.current.get(name);
        const row = {
          ...report,
          name,
          method: "POST" as const,
          path: `/api/${name}`,
          ms: report?.ms ?? 0,
          ...detail,
        };
        notify(row);
        setRows((previous) => [
          row,
          ...previous.filter((item) => item.requestId !== row.requestId),
        ]);
        throw new Error(detail.message);
      });
  };
  const approve = (action: Action, send: () => Promise<unknown>) => {
    if (approvalNeeded(action)) setPending({ action, send });
    else void perform(action, send).catch(() => undefined);
  };
  const dismissConfirm = (approved: boolean) => {
    if (approved && pending) void perform(pending.action, pending.send).catch(() => undefined);
    setPending(null);
  };
  const can = (permission?: string) =>
    !permission || profile?.access.permissions.includes(permission);
  const allowed = menu.filter((item) => can(item.permission));
  const current = allowed.find((item) => item.key === section)?.key ?? "overview";
  const data = options.data?.personId === profile?.person.id ? options.data : null;
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        {!ready ? (
          <div className="mx-auto mt-24 max-w-sm space-y-4 p-6">
            <Skeleton className="h-12 w-48" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : !profile ? (
          <AuthPanel client={client} perform={perform} />
        ) : (
          <div className="min-h-screen bg-muted/20 md:flex">
            <aside className="flex flex-col border-b bg-sidebar md:fixed md:inset-y-0 md:w-64 md:border-r">
              <a href="#overview" className="flex h-20 items-center gap-3 px-6 font-semibold">
                <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <CalendarDays className="size-5" />
                </span>
                Booking
                <span className="ml-auto text-xs font-normal text-muted-foreground">Workspace</span>
              </a>
              <div className="px-6 pb-3 pt-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Workspace
              </div>
              <nav aria-label="Main navigation" className="grid gap-1 px-3">
                {allowed.map(({ key, name, icon: Icon }) => (
                  <a
                    key={key}
                    href={`#${key}`}
                    aria-current={current === key ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent ${current === key ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground"}`}
                  >
                    <Icon className="size-4" />
                    {name}
                  </a>
                ))}
              </nav>
              <div className="mt-auto border-t p-3 md:mb-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2 py-3">
                      <Avatar name={profile.person.displayName} />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium">
                          {profile.person.displayName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          Your account
                        </span>
                      </span>
                      <ChevronsUpDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-64">
                    <div className="grid gap-2 border-b p-3">
                      <p className="text-sm font-medium">{profile.person.displayName}</p>
                      <ScopeBadges items={profile.access.roles} />
                    </div>
                    {can("identity:update") && (
                      <DropdownMenuItem onSelect={() => setPassword(true)}>
                        Change password
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        void perform("signOut", () => client.signOut({})).catch(() => undefined);
                      }}
                    >
                      <LogOut className="size-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </aside>
            <main className="min-w-0 flex-1 px-5 py-8 pb-28 md:ml-64 md:px-10">
              <div className="mx-auto max-w-7xl">
                {options.error ? (
                  <p role="alert" className="rounded-lg border p-6 text-destructive">
                    Workspace data could not be retrieved. {options.error}
                  </p>
                ) : !data ? (
                  <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                ) : (
                  <DashboardContext.Provider
                    value={{
                      client,
                      profile,
                      roles: data.roles,
                      catalogue: data.catalogue,
                      organisations: data.organisations,
                      epoch,
                      perform,
                      approve,
                      report: (error) => {
                        const detail = failureDetail(error);
                        notify({
                          name: "request",
                          method: "POST",
                          path: "/api",
                          ms: 0,
                          ...lastFailure.current,
                          ...detail,
                        });
                      },
                    }}
                  >
                    {current === "overview" && <OverviewPanel />}
                    {current === "bookings" && <BookingsPanel />}
                    {current === "organisations" && <OrganisationsPanel />}
                    {current === "people" && <PeoplePanel />}
                    {current === "roles" && <RolesPanel />}
                    {current === "audit" && <AuditPanel />}
                    {current === "framework" && <FrameworkPanel />}
                  </DashboardContext.Provider>
                )}
              </div>
            </main>
          </div>
        )}
        <AuditDock
          key={profile?.person.id ?? "signed-out"}
          client={client}
          personId={profile?.person.id}
          calls={rows}
        />
        <FormDialog
          title="Change password"
          description="Enter your current password and choose a new one."
          open={password}
          onOpenChange={setPassword}
        >
          {password && (
            <ActionForm
              title="Update password"
              fields={[
                { name: "current", label: "Current password", type: "password" },
                { name: "next", label: "New password", type: "password", minLength: 12 },
              ]}
              submit={(form) => {
                return perform("changePassword", () =>
                  client.changePassword({
                    current: String(form.get("current") ?? ""),
                    next: String(form.get("next") ?? ""),
                  }),
                ).then(() => setPassword(false));
              }}
            />
          )}
        </FormDialog>
        <AlertDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) dismissConfirm(false);
          }}
        >
          <AlertDialogContent>
            <AlertDialogTitle className="text-lg font-semibold">
              Confirm{" "}
              {pending ? api.endpoints[pending.action].feature.name.replaceAll("_", " ") : "action"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This changes access or removes data. Confirm only if you intend to continue.
              Cancelling sends nothing.
            </AlertDialogDescription>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel asChild>
                <Button variant="outline" onClick={() => dismissConfirm(false)}>
                  Keep unchanged
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive" onClick={() => dismissConfirm(true)}>
                  Confirm
                </Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
        <Toasts
          rows={notices}
          dismiss={(id) =>
            setNotices((previous) => previous.filter((notice) => notice.toastId !== id))
          }
        />
      </ToastProvider>
    </TooltipProvider>
  );
}
