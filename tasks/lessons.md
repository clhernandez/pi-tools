# Lessons

- When integrating packaged subagents with `subagent-models`, do not hardcode concrete provider models in agent frontmatter. Prefer role-based resolution (`cheap` / `standard` / `capable`) so runtime behavior matches the dynamic model-selection extension.
- Do not overload an existing role when the workflow semantics differ. If implementation should be tuned independently from scouting, add a dedicated `implementer` role instead of reusing `cheap`.
- When assigning default subagent roles, confirm each agent's intended responsibility explicitly with the user instead of assuming reviewer/planner should both use the most capable role.
- Keep tool timeouts tight by default. Do not use very long timeouts (like 300s) unless the command genuinely needs them; start smaller and increase only with explicit justification.
- For small follow-up tasks, do a fast state check first and avoid over-orchestrating with long-running subagent loops when a quick direct assessment will do.
- When a user points to an existing built-in UI behavior (like Pi's loader/spinner), verify the actual exported component/API and reuse that implementation instead of approximating it with a custom text-based clone.
- When testing animated TUI behavior, treat hangs or frozen loaders as root-cause bugs first; do not continue layering UI changes until the lifecycle of timers/components is understood and safe.
