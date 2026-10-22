import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Label } from "./components/ui/label.tsx";
import { Select } from "./components/ui/select.tsx";
export const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
export type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string | undefined;
  optional?: boolean;
  options?: readonly { value: string; label: string; disabled?: boolean }[];
  pattern?: string;
  hint?: string;
  min?: number;
  minLength?: number;
  readOnly?: boolean;
};
function FormField({ field, id }: { field: Field; id: string }) {
  const [value, setValue] = useState(field.value ?? "");
  return (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
      {field.options ? (
        <Select
          name={field.name}
          value={value}
          onValueChange={setValue}
          options={field.options}
          placeholder={field.label}
          required={!field.optional}
        />
      ) : (
        <Input
          id={`${id}-${field.name}`}
          name={field.name}
          type={field.type ?? "text"}
          defaultValue={field.value}
          required={!field.optional}
          pattern={field.pattern}
          min={field.min}
          minLength={field.minLength}
          readOnly={field.readOnly}
          aria-describedby={field.hint ? `${id}-${field.name}-hint` : undefined}
        />
      )}
      {field.hint && (
        <p id={`${id}-${field.name}-hint`} className="text-xs text-muted-foreground">
          {field.hint}
        </p>
      )}
    </div>
  );
}
export function ActionForm({
  title,
  fields,
  submit,
  children,
  disabled = false,
}: {
  title: string;
  fields: readonly Field[];
  submit: (data: FormData) => Promise<unknown>;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    void submit(data)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "Request failed. Please try again."),
      )
      .finally(() => setBusy(false));
  };
  return (
    <form
      onSubmit={send}
      onInvalid={(event) => {
        if (event.target instanceof HTMLInputElement) setError(event.target.validationMessage);
      }}
      className="grid gap-4"
    >
      {fields.map((field) => (
        <FormField key={field.name} field={field} id={id} />
      ))}
      {children}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button disabled={disabled || busy} type="submit">
        {busy ? "Saving…" : title}
      </Button>
    </form>
  );
}
