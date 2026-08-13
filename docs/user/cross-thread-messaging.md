# Cross-thread messaging

Cross-thread messaging lets an active agent send a short message to another thread. The server identifies the source thread, applies the operator's permission setting, and records every delivery or rejection in the affected timelines.

## Choose who can message

Open **Settings → Providers**, then set **Cross-thread messaging**:

- **Off — threads stay isolated**: Agents do not receive messaging tools. This is the default.
- **Crew only — planners and their dispatched agents**: A thread can message its dispatch parent, its direct dispatch children, and sibling agents dispatched by the same parent turn.
- **Project — any thread in the same project**: A thread can message any other active thread in its project.

Messages never cross devices or execution environments. Changing the setting affects newly started provider sessions. Restart an active thread session if it needs the new capability.

## Delivery behavior

The receiving agent always sees a server-owned source header. Text supplied by an agent cannot replace that header.

If the target is running and its provider supports active-turn steering, the message joins that turn. Otherwise, T3 Code keeps it in a durable per-thread FIFO and starts the next turn when the target is ready. Queued crew turns preserve their crew assignment.

Each delivery adds a source chip to the target transcript and a progress entry to the sender's turn. Select the source chip on web or desktop to open the sending thread. A rejected message adds the reason to the source transcript.

An agent can send at most 20 cross-thread messages from one source turn.

## Mobile

Cross-thread message and rejection audit lines appear in the mobile thread feed. Change the permission level from the web or desktop Providers settings.
