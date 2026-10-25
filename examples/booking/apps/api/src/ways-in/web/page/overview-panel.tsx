import { BookOpen, Building2, ArrowUpRight } from "lucide-react";
import { useDashboard, useResource } from "./dashboard.tsx";
import { PageHeading, ScopeBadges } from "./screen-kit.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card.tsx";
import { Button } from "./components/ui/button.tsx";
export function OverviewPanel() {
  const { client, profile, organisations, epoch } = useDashboard();
  const bookings = useResource(
    () =>
      profile.access.permissions.includes("bookings:read")
        ? client.myBookings({})
        : Promise.resolve([]),
    [client, profile.person.id, epoch],
  );
  return (
    <>
      <PageHeading
        title={`Hello, ${profile.person.displayName.split(" ")[0]}`}
        description="Here's your booking workspace today."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">My bookings</CardTitle>
            <BookOpen className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {bookings.loading
                ? "…"
                : bookings.error
                  ? "Unavailable"
                  : (bookings.data?.length ?? 0)}
            </p>
            {profile.access.permissions.includes("bookings:read") && (
              <a
                href="#bookings"
                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                View reservations
                <ArrowUpRight className="size-3" />
              </a>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Organisations</CardTitle>
            <Building2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{organisations.length}</p>
            <a
              href="#organisations"
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              Manage your teams
              <ArrowUpRight className="size-3" />
            </a>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your workspace</CardTitle>
          <CardDescription>Your roles determine the actions available to you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <ScopeBadges items={profile.access.roles} />
          <div>
            <h3 className="mb-2 text-sm font-medium">Your organisations</h3>
            {organisations.length ? (
              <div className="flex flex-wrap gap-2">
                {organisations.map((org) => (
                  <a
                    key={org.id}
                    href="#organisations"
                    className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                  >
                    {org.name}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                You haven't joined an organisation yet.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {profile.access.permissions.includes("bookings:read") && (
              <Button asChild>
                <a href="#bookings">Manage bookings</a>
              </Button>
            )}
            <Button variant="outline" asChild>
              <a href="#organisations">Join or create a team</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
