import { CalendarDays } from "lucide-react";
import { ActionForm, text } from "./action-form.tsx";
import { QuickSignIn } from "./quick-sign-in.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs.tsx";
import type { Action, Client } from "./session.ts";
const fields = [
  { name: "email", label: "Email", type: "email" },
  { name: "password", label: "Password", type: "password", minLength: 12 },
];
export function AuthPanel({
  client,
  perform,
}: {
  client: Client;
  perform: <T>(action: Action, send: () => Promise<T>) => Promise<T>;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-6 pb-24">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <CalendarDays className="size-6" />
          Booking
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to manage your bookings and teams.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sign-in">
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="sign-in">
                  Sign in
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="sign-up">
                  Sign up
                </TabsTrigger>
              </TabsList>
              <TabsContent value="sign-in">
                <ActionForm
                  title="Sign in"
                  fields={fields}
                  submit={(data) =>
                    perform("signIn", () =>
                      client.signIn({
                        email: text(data, "email"),
                        password: String(data.get("password") ?? ""),
                      }),
                    )
                  }
                >
                  <QuickSignIn disabled={false} />
                </ActionForm>
              </TabsContent>
              <TabsContent value="sign-up">
                <ActionForm
                  title="Create account"
                  fields={[{ name: "displayName", label: "Your name" }, ...fields]}
                  submit={(data) =>
                    perform("signUp", () =>
                      client.signUp({
                        displayName: text(data, "displayName"),
                        email: text(data, "email"),
                        password: String(data.get("password") ?? ""),
                      }),
                    )
                  }
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">House rules reference app</p>
      </div>
    </main>
  );
}
