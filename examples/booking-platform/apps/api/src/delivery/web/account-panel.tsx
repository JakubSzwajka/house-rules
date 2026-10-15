import type { Person } from "@house-rules/party/contract";
import { type FormEvent, useState } from "react";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";
import { ProblemAlert } from "./problem-alert.js";
import type { Clients } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{
  clients: Clients;
  onMe: (me: Person) => void;
}>;

export function AccountPanel({ clients, onMe }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { problem, run } = useCall();

  // The first call after a new login runs FirstSignIn on the server: a Person is created.
  const loadMe = () => clients.member.showMe({});

  const signIn = (event: FormEvent) => {
    event.preventDefault();
    run(() => clients.accounts.signIn({ email, password }).then(loadMe), onMe);
  };

  const signUp = (event: FormEvent) => {
    event.preventDefault();
    run(() => clients.accounts.signUp({ email, password, displayName }).then(loadMe), onMe);
  };

  const emailField = (id: string) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>Email</Label>
      <Input
        id={id}
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
    </div>
  );

  const passwordField = (id: string, autoComplete: string) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>Password</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
    </div>
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Stays</CardTitle>
        <CardDescription>Book a stay and keep notes on it.</CardDescription>
      </CardHeader>
      <Tabs defaultValue="sign-in">
        <CardContent>
          <div className="grid gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="sign-up">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">
              <form className="grid gap-4" onSubmit={signIn}>
                {emailField("sign-in-email")}
                {passwordField("sign-in-password", "current-password")}
                <Button type="submit">Sign in</Button>
              </form>
            </TabsContent>
            <TabsContent value="sign-up">
              <form className="grid gap-4" onSubmit={signUp}>
                <div className="grid gap-2">
                  <Label htmlFor="sign-up-name">Your name</Label>
                  <Input
                    id="sign-up-name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                  />
                </div>
                {emailField("sign-up-email")}
                {passwordField("sign-up-password", "new-password")}
                <Button type="submit">Create account</Button>
              </form>
            </TabsContent>
            <ProblemAlert problem={problem} />
          </div>
        </CardContent>
      </Tabs>
    </Card>
  );
}
