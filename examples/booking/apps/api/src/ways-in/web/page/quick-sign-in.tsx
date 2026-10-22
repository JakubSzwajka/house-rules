import type { MouseEvent } from "react";
import { Button } from "./components/ui/button.tsx";
import { Avatar } from "./components/ui/avatar.tsx";
import { Badge } from "./components/ui/badge.tsx";
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
    <div className="mt-2 grid gap-1 border-t pt-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Demo accounts</p>
      {[
        { name: "alice", role: "Member" },
        { name: "bob", role: "Partner" },
        { name: "carol", role: "Org admin" },
        { name: "dave", role: "Staff" },
        { name: "admin", role: "Admin" },
      ].map(({ name, role }) => (
        <Button
          key={name}
          type="button"
          variant="ghost"
          className="h-auto justify-start gap-3 px-2 py-2"
          disabled={disabled}
          onClick={(event) => prefillAndSubmit(event, name)}
        >
          <Avatar name={name} />
          <span className="capitalize">{name}</span>
          <Badge variant="secondary" className="ml-auto">
            {role}
          </Badge>
        </Button>
      ))}
    </div>
  );
}
