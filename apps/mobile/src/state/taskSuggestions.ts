import { createTaskSuggestionEnvironmentAtoms } from "@t3tools/client-runtime/state/task-suggestions";

import { connectionAtomRuntime } from "../connection/runtime";

export const taskSuggestionEnvironment =
  createTaskSuggestionEnvironmentAtoms(connectionAtomRuntime);
