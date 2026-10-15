import { useCallback, useState } from "react";
import { type Problem, problemOf } from "./session.js";

export const useCall = () => {
  const [problem, setProblem] = useState<Problem | null>(null);
  // Stable across renders, so an effect can depend on it.
  const run = useCallback(<A>(call: () => Promise<A>, done: (value: A) => void) => {
    setProblem(null);
    void call().then(done, (error: unknown) => setProblem(problemOf(error)));
  }, []);
  return { problem, run };
};
