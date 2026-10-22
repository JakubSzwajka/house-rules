import { type FormEvent, type ReactNode, useId } from "react";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.tsx";
import { Input } from "./components/ui/input.tsx";
import { Label } from "./components/ui/label.tsx";
export const text = (data: FormData, name: string) => String(data.get(name) ?? "");
export function ActionForm({
  title,
  fields,
  submit,
  children,
  disabled,
}: {
  title: string;
  fields: readonly {
    name: string;
    label: string;
    type?: string;
    value?: string;
    optional?: boolean;
    options?: readonly { value: string; label: string }[];
  }[];
  submit: (data: FormData) => void;
  children?: ReactNode;
  disabled: boolean;
}) {
  const id = useId();
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={send} className="grid gap-4">
          {fields.map((field) => (
            <div className="grid gap-2" key={field.name}>
              <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
              {field.options ? (
                <select
                  id={`${id}-${field.name}`}
                  name={field.name}
                  required={!field.optional}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  defaultValue=""
                >
                  <option value="">Choose a person</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`${id}-${field.name}`}
                  name={field.name}
                  type={field.type ?? "text"}
                  defaultValue={field.value}
                  required={!field.optional}
                />
              )}
            </div>
          ))}
          {children}
          <Button disabled={disabled} type="submit">
            {title}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
