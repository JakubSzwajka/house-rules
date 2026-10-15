import type { Person } from "@house-rules/party/contract";
import { ChevronDownIcon, KeyRoundIcon, LogOutIcon, PencilIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "./components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { ProblemAlert } from "./problem-alert.js";
import type { Member } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{
  member: Member;
  me: Person;
  onMe: (me: Person) => void;
  onSignOut: () => void;
}>;

type Open = "rename" | "password" | null;

export function ProfilePanel({ member, me, onMe, onSignOut }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const close = (done?: string) => {
    setOpen(null);
    if (done !== undefined) setNotice(done);
  };

  return (
    <div className="flex items-center gap-3">
      {notice !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost">
            {me.displayName}
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Signed in as {me.displayName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen("rename")}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("password")}>
            <KeyRoundIcon />
            Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open === "rename"} onOpenChange={(next) => !next && close()}>
        {open === "rename" && (
          <RenameForm
            member={member}
            me={me}
            onDone={(person) => {
              onMe(person);
              close("Name saved.");
            }}
          />
        )}
      </Dialog>
      <Dialog open={open === "password"} onOpenChange={(next) => !next && close()}>
        {open === "password" && (
          <PasswordForm
            member={member}
            // Tokens signed before the change stay valid until they expire.
            onDone={() => close("Password changed. Use the new one next time you sign in.")}
          />
        )}
      </Dialog>
    </div>
  );
}

type RenameProps = Readonly<{ member: Member; me: Person; onDone: (me: Person) => void }>;

function RenameForm({ member, me, onDone }: RenameProps) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const { problem, run } = useCall();

  const rename = (event: FormEvent) => {
    event.preventDefault();
    run(() => member.renamePerson({ id: me.id, displayName }), onDone);
  };

  return (
    <DialogContent>
      <form className="grid gap-4" onSubmit={rename}>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>The name other people see on your comments.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rename-name">Name</Label>
          <Input
            id="rename-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <ProblemAlert problem={problem} />
        <DialogFooter>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

type PasswordProps = Readonly<{ member: Member; onDone: () => void }>;

function PasswordForm({ member, onDone }: PasswordProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const { problem, run } = useCall();

  const change = (event: FormEvent) => {
    event.preventDefault();
    run(() => member.changePassword({ current, next }), onDone);
  };

  return (
    <DialogContent>
      <form className="grid gap-4" onSubmit={change}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Type the one you use now, then the new one.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="password-current">Current password</Label>
          <Input
            id="password-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password-next">New password</Label>
          <Input
            id="password-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>
        <ProblemAlert problem={problem} />
        <DialogFooter>
          <Button type="submit">Change password</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
