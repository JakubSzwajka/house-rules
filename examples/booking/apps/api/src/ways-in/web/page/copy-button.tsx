import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Toast } from "radix-ui";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { copyText } from "./clipboard.ts";
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        onClick={() => {
          void copyText(value).then((success) => {
            setCopied(success);
            setFailed(!success);
            setNotice(true);
          });
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
      {failed && (
        <Input
          aria-label="Code to copy"
          value={value}
          readOnly
          ref={(input) => {
            input?.focus();
            input?.select();
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <Toast.Root
        open={notice}
        onOpenChange={setNotice}
        className="rounded-lg border bg-background p-4 shadow-xl"
      >
        <Toast.Title>{copied ? "Copied" : "Copy failed, select the code and copy it"}</Toast.Title>
      </Toast.Root>
    </>
  );
}
