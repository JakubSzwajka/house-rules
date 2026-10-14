import { useState } from "react";
import { problemOf } from "./session.js";

export const useCall = () => {
  const [problem, setProblem] = useState<string | null>(null);
  const run = <A>(call: () => Promise<A>, done: (value: A) => void) => {
    setProblem(null);
    void call().then(done, (error: unknown) => setProblem(problemOf(error)));
  };
  return { problem, run };
};
