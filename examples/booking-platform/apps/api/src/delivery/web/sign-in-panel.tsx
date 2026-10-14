import type { Person } from "@house-rules/party/contract";
import { type FormEvent, useState } from "react";
import type { Clients } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{
  clients: Clients;
  me: Person | null;
  onToken: (token: string | undefined) => void;
  onMe: (me: Person | null) => void;
}>;

export function SignInPanel({ clients, me, onToken, onMe }: Props) {
  const [name, setName] = useState("Alice");
  const { problem, run } = useCall();

  const signIn = (event: FormEvent) => {
    event.preventDefault();
    run(
      () =>
        clients.dev.signIn({ name: name.trim() }).then(({ token }) => {
          onToken(token);
          // The first call with a new token runs FirstSignIn on the server: a Person is created.
          return clients.member.showMe({});
        }),
      onMe,
    );
  };

  const signOut = () => {
    onToken(undefined);
    onMe(null);
  };

  return (
    <section>
      <h2>1. Sign in</h2>
      {me === null ? (
        <form onSubmit={signIn}>
          <label>
            Name <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit">Sign in</button>
        </form>
      ) : (
        <div>
          <p>
            Signed in as <strong>{me.displayName}</strong>
          </p>
          <dl>
            <dt>Person id</dt>
            <dd>
              <code>{me.id}</code>
            </dd>
          </dl>
          <button type="button" onClick={() => run(() => clients.member.showMe({}), onMe)}>
            Show me again
          </button>{" "}
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
      {problem !== null && <p className="problem">{problem}</p>}
    </section>
  );
}
