import type { MouseEvent } from "react";
import { Button } from "./components/ui/button.tsx";

const prefillAndSubmit = (event: MouseEvent<HTMLButtonElement>, name: string) => {
  const form = event.currentTarget.form;
  if (!form) return;
  const email = form.elements.namedItem("email");
  const password = form.elements.namedItem("password");
  if (!(email instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)) return;
  email.value = `${name}@example.test`;
  password.value = "house-rules-demo";
  form.requestSubmit();
};
export function QuickSignIn({ disabled }: { disabled: boolean }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Development demo accounts">
      {["alice", "bob", "carol", "dave", "admin"].map((name) => (
        <Button
          key={name}
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={(event) => prefillAndSubmit(event, name)}
        >
          Sign in as {name}
        </Button>
      ))}
    </div>
  );
}
