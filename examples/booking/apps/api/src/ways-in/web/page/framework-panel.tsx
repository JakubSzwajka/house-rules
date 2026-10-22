import { Features } from "../../../features/index.ts";
import { api } from "../endpoints.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.tsx";
export function FrameworkPanel() {
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Ways</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            web /api: all dashboard features, browser confirmation. partner /partner:
            book_for_partner, no approval. mcp /mcp: show_booking and my_bookings, human
            elicitation. Node Host serves this page; auth-jwt verifies credentials.
          </p>
        </CardContent>
      </Card>
      {Object.values(Features).map((feature) => (
        <Card key={feature.name}>
          <CardHeader>
            <CardTitle>{feature.name}</CardTitle>
            <CardDescription>{feature.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(
                {
                  permission: feature.permission,
                  flags: {
                    readOnly: feature.readOnly,
                    transactional: feature.transactional,
                    destructive: feature.destructive,
                    needsApproval: feature.needsApproval,
                  },
                  edges: feature.edges.map((edge) =>
                    "target" in edge
                      ? { target: edge.target.name, caller: "system", reason: edge.reason }
                      : { target: edge.name, caller: "same" },
                  ),
                  ways: [
                    ...(Object.values(api.endpoints).some(
                      (endpoint) => endpoint.feature.name === feature.name,
                    )
                      ? ["web"]
                      : []),
                    ...(["show_booking", "my_bookings"].includes(feature.name) ? ["mcp"] : []),
                    ...(feature.name === "book_for_partner" ? ["partner"] : []),
                  ],
                },
                null,
                2,
              )}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
