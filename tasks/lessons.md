# Lessons

- When integrating packaged subagents with `subagent-models`, do not hardcode concrete provider models in agent frontmatter. Prefer role-based resolution (`cheap` / `standard` / `capable`) so runtime behavior matches the dynamic model-selection extension.
