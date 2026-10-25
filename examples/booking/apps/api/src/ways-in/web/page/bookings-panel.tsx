import { useState } from "react";
import { Plus } from "lucide-react";
import { browserId } from "./browser-id.ts";
import { canAdmin, useDashboard, useResource } from "./dashboard.tsx";
import { ActionForm, text } from "./action-form.tsx";
import { DataTable, FormDialog, GuardButton, PageHeading, RowActions } from "./screen-kit.tsx";
import { TableCell } from "./components/ui/table.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./components/ui/sheet.tsx";
import { Select } from "./components/ui/select.tsx";
import type { Client } from "./session.ts";
type Booking = Awaited<ReturnType<Client["myBookings"]>>[number];
export function BookingsPanel({ organisationId }: { organisationId?: string }) {
  const { client, profile, roles, organisations, epoch, perform, approve } = useDashboard();
  const [filter, setFilter] = useState("all");
  const staffOrgs = organisations.filter(
    (org) => org.relation === "staff" || canAdmin(profile, roles, org.id),
  );
  const selected = organisationId ?? filter;
  const bookings = useResource(() => client.myBookings({}), [client, epoch]);
  const [create, setCreate] = useState(false);
  const [view, setView] = useState<Booking | null>(null);
  const canWrite = ["bookings:write", "billing:charge"].every((permission) =>
    profile.access.permissions.includes(permission),
  );
  const newButton = (
    <GuardButton
      reason={canWrite ? undefined : "You need bookings:write and billing:charge"}
      onClick={() => setCreate(true)}
    >
      <Plus className="size-4" />
      New booking
    </GuardButton>
  );
  return (
    <>
      <PageHeading title="Bookings" description="Your reservations and payment status.">
        {newButton}
      </PageHeading>
      {!organisationId && (
        <div className="mb-4 w-56">
          <Select
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "personal", label: "Personal" },
              ...organisations.map((org) => ({ value: org.id, label: org.name })),
            ]}
          />
        </div>
      )}
      <DataTable
        columns={["Guest", "Booking", "Org", "Status", "Payment", "Amount", "Actions"]}
        rows={(bookings.data ?? []).filter(
          (booking) =>
            selected === "all" ||
            (selected === "personal"
              ? booking.organisationId === null
              : booking.organisationId === selected),
        )}
        loading={bookings.loading}
        error={bookings.error}
        rowKey={(booking) => booking.id}
        empty={
          <>
            <p>You haven't made a booking yet.</p>
            {newButton}
          </>
        }
        render={(booking) => (
          <>
            <TableCell className="px-5 font-medium">{booking.guestName}</TableCell>
            <TableCell className="font-mono text-xs">{booking.id}</TableCell>
            <TableCell>
              {organisations.find((org) => org.id === booking.organisationId)?.name ??
                booking.organisationId ??
                "Personal"}
            </TableCell>
            <TableCell>
              <Badge variant={booking.status === "cancelled" ? "secondary" : "outline"}>
                {booking.status}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{booking.paymentStatus ?? "No payment"}</Badge>
            </TableCell>
            <TableCell>{booking.amount}</TableCell>
            <TableCell>
              <RowActions
                actions={[
                  { label: "View", onSelect: () => setView(booking) },
                  ...(booking.ownerId === profile.person.id ||
                  (booking.organisationId !== null &&
                    canAdmin(profile, roles, booking.organisationId) &&
                    organisations.some(
                      (org) => org.id === booking.organisationId && org.relation === "staff",
                    ))
                    ? [
                        {
                          label: "Cancel booking",
                          destructive: true,
                          reason: !profile.access.permissions.includes("bookings:cancel")
                            ? "You need bookings:cancel"
                            : booking.status === "cancelled"
                              ? "This booking is already cancelled"
                              : undefined,
                          onSelect: () => {
                            approve("cancelBooking", () =>
                              client.cancelBooking({ id: booking.id }),
                            );
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </TableCell>
          </>
        )}
      />
      <FormDialog
        title="New booking"
        description="Reserve a place and record a payment."
        open={create}
        onOpenChange={setCreate}
      >
        {create && (
          <ActionForm
            title="Create booking"
            fields={[
              {
                name: "organisationId",
                label: "For",
                value: organisationId ?? "personal",
                options: [
                  { value: "personal", label: "Personal" },
                  ...staffOrgs.map((org) => ({ value: org.id, label: org.name })),
                ],
              },
              { name: "guestName", label: "Guest name", value: profile.person.displayName },
              {
                name: "amount",
                label: "Amount (whole units)",
                type: "number",
                value: "100",
                min: 1,
              },
            ]}
            submit={(data) => {
              return perform("makeBooking", () =>
                client.makeBooking({
                  id: browserId(),
                  paymentId: browserId(),
                  guestName: text(data, "guestName"),
                  organisationId:
                    text(data, "organisationId") === "personal"
                      ? null
                      : text(data, "organisationId"),
                  amount: Number(text(data, "amount")),
                }),
              ).then(() => setCreate(false));
            }}
          />
        )}
      </FormDialog>
      <Sheet
        open={view !== null}
        onOpenChange={(open) => {
          if (!open) setView(null);
        }}
      >
        <SheetContent>
          <SheetTitle className="text-xl font-semibold">Booking details</SheetTitle>
          <SheetDescription>Your reservation and payment summary.</SheetDescription>
          {view && (
            <dl className="grid grid-cols-[auto_1fr] gap-4 text-sm">
              <dt className="text-muted-foreground">Guest</dt>
              <dd>{view.guestName}</dd>
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="break-all">{view.id}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant="outline">{view.status}</Badge>
              </dd>
              <dt className="text-muted-foreground">Payment</dt>
              <dd>{view.paymentStatus}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd>{view.amount}</dd>
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
