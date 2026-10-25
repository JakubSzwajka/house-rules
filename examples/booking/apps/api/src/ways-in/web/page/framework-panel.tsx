import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Features } from "../../../features/index.ts";
import { api } from "../endpoints.ts";
import { useDashboard } from "./dashboard.tsx";
import { PageHeading } from "./screen-kit.tsx";
import { Button } from "./components/ui/button.tsx";
import { Badge } from "./components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.tsx";
export function FrameworkPanel() {
  const { client, perform } = useDashboard();
  const [expanded, setExpanded] = useState<string | null>(null);
  const demo = (send: () => Promise<unknown>) => {
    void send().catch(() => undefined);
  };
  return (
    <>
      <PageHeading
        title="Framework"
        description="Explore the features, declared edges and access rules behind this app."
      />
      <div className="mb-6 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {["Feature", "Description", "Permission", "Flags", "Ways"].map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.values(Features).map((feature) => (
              <Fragment key={feature.name}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      aria-expanded={expanded === feature.name}
                      className="flex items-center gap-2 font-mono text-xs"
                      onClick={() => setExpanded(expanded === feature.name ? null : feature.name)}
                    >
                      {expanded === feature.name ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                      {feature.name}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                    {feature.description}
                  </TableCell>
                  <TableCell className="text-xs">{feature.permission ?? "None"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {[
                        feature.readOnly && "Read only",
                        feature.transactional && "Transaction",
                        feature.destructive && "Destructive",
                        feature.needsApproval && "Approval",
                      ]
                        .filter(Boolean)
                        .map((flag) => (
                          <Badge key={String(flag)} variant="secondary">
                            {flag}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {[
                        ...(Object.values(api.endpoints).some(
                          (endpoint) => endpoint.feature.name === feature.name,
                        )
                          ? ["web"]
                          : []),
                        ...(["show_booking", "my_bookings"].includes(feature.name) ? ["mcp"] : []),
                      ].map((way) => (
                        <Badge key={way} variant="outline">
                          {way}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
                {expanded === feature.name && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/30 p-5">
                      <h4 className="mb-3 text-sm font-medium">Declared edges</h4>
                      <ul className="grid gap-2">
                        {feature.edges.map((edge) => (
                          <li
                            key={"target" in edge ? edge.target.name : edge.name}
                            className="flex flex-wrap gap-3 text-xs"
                          >
                            <code>{"target" in edge ? edge.target.name : edge.name}</code>
                            <Badge variant="outline">
                              {"target" in edge ? "System caller" : "Same caller"}
                            </Badge>
                            {"target" in edge && (
                              <span className="text-muted-foreground">{edge.reason}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Error playground</CardTitle>
          <CardDescription>
            Try deliberate failures. See the public response and request id in a notification.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              demo(() =>
                perform("defineRole", () =>
                  client.defineRole({
                    key: "demo-denied",
                    name: "Demo",
                    permissions: ["identity:create"],
                    organisationId: null,
                  }),
                ),
              )
            }
          >
            403 · Forbidden
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              demo(() =>
                perform("signUp", () =>
                  client.signUp({ email: "not-an-email", password: "short", displayName: "" }),
                ),
              )
            }
          >
            400 · Invalid input
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              demo(() =>
                perform("showBooking", () => client.showBooking({ id: "missing-booking-demo" })),
              )
            }
          >
            404 · Not found
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              demo(() =>
                perform("signIn", () =>
                  client.signIn({
                    email: "admin@example.test",
                    password: "deliberately-wrong-password",
                  }),
                ),
              )
            }
          >
            Wrong password
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
