# Lessons

- When integrating packaged subagents with `subagent-models`, do not hardcode concrete provider models in agent frontmatter. Prefer role-based resolution (`cheap` / `standard` / `capable`) so runtime behavior matches the dynamic model-selection extension.
- Do not overload an existing role when the workflow semantics differ. If implementation should be tuned independently from scouting, add a dedicated `implementer` role instead of reusing `cheap`.
- When assigning default subagent roles, confirm each agent's intended responsibility explicitly with the user instead of assuming reviewer/planner should both use the most capable role.
