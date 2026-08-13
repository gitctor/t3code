# Suggested tasks

Agents can suggest follow-up work that deserves its own thread. A suggestion does not start work by itself. You decide what happens next.

## Review a suggestion

A suggestion appears after the turn that created it. It includes:

- A short task title.
- The recommended provider and model, when the agent supplied them.
- A concurrency label.

`Parallel-safe` means the agent expects the task to run beside other work. `Run solo — touches shared state` means you should finish or pause conflicting work first. Point to the label to see the agent's reason.

The project header shows the number of pending suggestions. Select the counter to review suggestions across the project's threads.

## Accept or dismiss

Select **Accept** to create a thread for the task. T3 Code creates a separate Git worktree, starts the thread with the suggested prompt, and opens it. A suggestion never starts without this action.

The new thread uses the recommended provider, model, and effort when they are available. Otherwise, it uses an available default for the source project.

Select **Dismiss** to remove a suggestion from the pending list. Open the **Dismissed** filter in the project header popover and select **Restore** to return it to pending.

## Mobile

Open **Settings**, then **Suggested tasks**, to review pending suggestions. You can accept or dismiss them from the same screen.

## Pending limit

Each source thread can have up to ten pending suggestions. Resolve old suggestions before an agent adds more.
