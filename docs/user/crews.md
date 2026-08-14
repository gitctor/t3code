# Crews

A crew gives one planner a saved set of provider seats to dispatch work to. Pick a crew from the model picker when you want a thread to show each child agent in the Agents panel and keep its live transcript available from the task row.

## Test a crew

Select **Test flight** beside a runnable crew or in its editor. T3 Code opens a chat-only thread named **Test flight — _crew name_** and asks the planner to send one trivial reply task to every member in parallel.

The test uses the cheapest suitable live model for the planner and each member without changing the saved crew. It creates no worktrees and asks agents not to edit files or use tools beyond dispatch. Unavailable seats appear as declined in the final table, so a partially available crew can still be checked.

Watch the existing Agents panel for seat status, provider, model, and **Needs you** state. Open any row to follow that child's live transcript.
