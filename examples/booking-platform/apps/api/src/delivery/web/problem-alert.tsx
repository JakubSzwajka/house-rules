import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import type { Problem } from "./session.js";

type Props = Readonly<{ problem: Problem | null }>;

export function ProblemAlert({ problem }: Props) {
  if (problem === null) return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{problem.code}</AlertTitle>
      <AlertDescription>{problem.message}</AlertDescription>
    </Alert>
  );
}
