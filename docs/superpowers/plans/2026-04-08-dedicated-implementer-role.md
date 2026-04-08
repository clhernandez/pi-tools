# Dedicated Implementer Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class `implementer` subagent-model role so packaged coding agents can be configured independently from `cheap`, with backward-compatible migration from existing 3-role configs.

**Architecture:** Extend the shared subagent model config schema from three roles to four, add migration on config read, and point the packaged `worker` agent at the new `implementer` role while keeping `scout` on `cheap`, `reviewer` on `standard`, and `planner` on `capable`. Update the interactive config UI, LLM tools, and docs so the new role is visible and testable end-to-end.

**Tech Stack:** TypeScript Pi extensions, markdown-based packaged agents, JSON config migration, Pi RPC verification.

---

## File Structure

### Modified files
- `extensions/subagent/model-config.ts` — role type expansion, default config, backward-compatible migration
- `extensions/subagent-models.ts` — UI and tool schemas updated to include `implementer`
- `extensions/subagent/agents.ts` — `modelRole` union updated to include `implementer`
- `extensions/subagent/agents/worker.md` — packaged implementer agent uses `modelRole: implementer`
- `extensions/subagent/agents/reviewer.md` — packaged reviewer agent uses `modelRole: standard`
- `README.md` — document four roles and their intended usage
- `tasks/todo.md` — record results of verification

### Verification helpers
- No permanent automated tests are added.
- Verification uses direct file checks plus Pi RPC prompts that inspect the runtime-resolved model for packaged agents.

---

### Task 1: Add the `implementer` role and migrate existing config safely

**Files:**
- Modify: `extensions/subagent/model-config.ts`
- Modify: `extensions/subagent-models.ts`
- Modify: `extensions/subagent/agents.ts`

- [ ] **Step 1: Write the failing verification command**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
python3 - <<'PY'
from pathlib import Path
text = Path('extensions/subagent/model-config.ts').read_text()
print('implementer' in text)
PY
```

Expected output:

```text
False
```

- [ ] **Step 2: Expand the shared model config to include `implementer`**

Update `extensions/subagent/model-config.ts` so it has these exact role declarations and defaults:

```ts
export type Role = "cheap" | "implementer" | "standard" | "capable";
export const ROLES: Role[] = ["cheap", "implementer", "standard", "capable"];
```

and in `DEFAULT_CONFIG`:

```ts
implementer: {
  model: "openrouter/minimax/minimax-m2.7",
  description: "Implementation tasks, code writing, and mechanical coding work",
},
```

Keep:
- `cheap` for scouting/recon
- `standard` for integration and general judgment
- `capable` for planning and highest-judgment review

- [ ] **Step 3: Add backward-compatible migration on config read**

Still in `extensions/subagent/model-config.ts`, change `readSubagentModelConfig()` so it upgrades old configs missing `implementer`.

The function must behave like this:

```ts
export function readSubagentModelConfig(): ModelConfig {
  if (!existsSync(CONFIG_PATH)) {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<ModelConfig> & {
    models?: Partial<ModelConfig["models"]>;
  };

  const merged: ModelConfig = {
    description: config.description || DEFAULT_CONFIG.description,
    models: {
      cheap: config.models?.cheap || DEFAULT_CONFIG.models.cheap,
      implementer:
        config.models?.implementer || {
          model: config.models?.cheap?.model || DEFAULT_CONFIG.models.implementer.model,
          description: config.models?.cheap?.description || DEFAULT_CONFIG.models.implementer.description,
        },
      standard: config.models?.standard || DEFAULT_CONFIG.models.standard,
      capable: config.models?.capable || DEFAULT_CONFIG.models.capable,
    },
  };

  if (!config.models?.implementer) {
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  }

  return merged;
}
```

This keeps old users working and auto-upgrades their file.

- [ ] **Step 4: Update the subagent-model config extension surface**

In `extensions/subagent-models.ts` make these exact changes:

1. Extend icons:
```ts
const ROLE_ICONS: Record<Role, string> = {
  cheap: "⚡",
  implementer: "🛠️",
  standard: "🔧",
  capable: "🧠",
};
```

2. Ensure role lists use imported `ROLES`, which now includes `implementer`.

3. Update the `update_subagent_model` tool schema to:
```ts
role: StringEnum(["cheap", "implementer", "standard", "capable"] as const, {
  description: "Role to update: cheap, implementer, standard, or capable",
}),
```

4. Update the `get_subagent_models` tool description to mention four roles:
```ts
"Get the current subagent model configuration. Returns the model mapping for cheap, implementer, standard, and capable roles."
```

- [ ] **Step 5: Extend packaged agent role typing**

In `extensions/subagent/agents.ts`, change the `modelRole` union to:

```ts
modelRole?: "cheap" | "implementer" | "standard" | "capable";
```

and update normalization to accept `implementer`:

```ts
const normalizedModelRole =
  modelRole === "cheap" ||
  modelRole === "implementer" ||
  modelRole === "standard" ||
  modelRole === "capable"
    ? modelRole
    : undefined;
```

- [ ] **Step 6: Run verification that the new role exists in code**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
python3 - <<'PY'
from pathlib import Path
model_config = Path('extensions/subagent/model-config.ts').read_text()
models_ext = Path('extensions/subagent-models.ts').read_text()
agents_ts = Path('extensions/subagent/agents.ts').read_text()
checks = [
    'implementer' in model_config,
    'implementer' in models_ext,
    'implementer' in agents_ts,
]
print(all(checks), checks)
PY
```

Expected output:

```text
True [True, True, True]
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add extensions/subagent/model-config.ts extensions/subagent-models.ts extensions/subagent/agents.ts && \
  git commit -m "feat: add dedicated implementer subagent role"
```

---

### Task 2: Reassign packaged agents and update docs

**Files:**
- Modify: `extensions/subagent/agents/worker.md`
- Modify: `extensions/subagent/agents/reviewer.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing verification command**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
python3 - <<'PY'
from pathlib import Path
worker = Path('extensions/subagent/agents/worker.md').read_text()
reviewer = Path('extensions/subagent/agents/reviewer.md').read_text()
print('worker implementer:', 'modelRole: implementer' in worker)
print('reviewer standard:', 'modelRole: standard' in reviewer)
PY
```

Expected output:

```text
worker implementer: False
reviewer standard: False
```

- [ ] **Step 2: Reassign packaged worker and reviewer roles**

Update `extensions/subagent/agents/worker.md` frontmatter from:

```md
modelRole: standard
```

to:

```md
modelRole: implementer
```

Update `extensions/subagent/agents/reviewer.md` frontmatter from:

```md
modelRole: capable
```

to:

```md
modelRole: standard
```

Keep:
- `scout` on `cheap`
- `planner` on `capable`

- [ ] **Step 3: Update README role documentation**

Edit `README.md` in the “Extension: Subagent Models” section so it lists four defaults:

```md
Default models:
- **cheap**: `minimax/minimax-m2.7` - Fast codebase scouting and mechanical lookup work
- **implementer**: `minimax/minimax-m2.7` - Implementation tasks, code writing, and mechanical coding work
- **standard**: `anthropic/claude-sonnet-4.6` - Reviews, integration tasks, multi-file coordination, debugging
- **capable**: `anthropic/claude-opus-4.6` - Architecture, design, planning, broad codebase understanding
```

Also add one line under the `subagent` extension section clarifying packaged role mapping:

```md
Packaged fallback role mapping: `scout` → `cheap`, `worker` → `implementer`, `reviewer` → `standard`, `planner` → `capable`
```

- [ ] **Step 4: Run file verification**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
python3 - <<'PY'
from pathlib import Path
worker = Path('extensions/subagent/agents/worker.md').read_text()
reviewer = Path('extensions/subagent/agents/reviewer.md').read_text()
readme = Path('README.md').read_text()
checks = [
    'modelRole: implementer' in worker,
    'modelRole: standard' in reviewer,
    '**implementer**:' in readme,
    'worker` → `implementer`' in readme,
]
print(all(checks), checks)
PY
```

Expected output:

```text
True [True, True, True, True]
```

- [ ] **Step 5: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add extensions/subagent/agents/worker.md extensions/subagent/agents/reviewer.md README.md && \
  git commit -m "docs: map packaged worker to implementer role"
```

---

### Task 3: Verify runtime behavior and migration end-to-end

**Files:**
- Modify: `tasks/todo.md`

- [ ] **Step 1: Write the failing verification command**

Before changing your live config, inspect whether `implementer` is currently missing from the installed config:

```bash
python3 - <<'PY'
import json
from pathlib import Path
path = Path.home() / '.pi/agent/subagent-models.json'
config = json.loads(path.read_text())
print('implementer' in config['models'])
PY
```

Expected output for an old config:

```text
False
```

If it already prints `True`, note that migration has already happened and continue.

- [ ] **Step 2: Update the installed package**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && git push origin main && pi update
```

Expected: package updates successfully.

- [ ] **Step 3: Verify config migration and visible role surface**

Run:

```bash
python3 - <<'PY'
import json, subprocess
from pathlib import Path

path = Path.home() / '.pi/agent/subagent-models.json'
config = json.loads(path.read_text())
print('config roles:', sorted(config['models'].keys()))

proc = subprocess.Popen(['pi', '--mode', 'rpc'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
proc.stdin.write(json.dumps({'id':'1','type':'prompt','message':'Call the get_subagent_models tool.'}) + '\n')
proc.stdin.flush()
seen = False
for _ in range(400):
    line = proc.stdout.readline()
    if not line:
        break
    if 'implementer' in line and 'cheap' in line and 'standard' in line and 'capable' in line:
        seen = True
    if '"type":"agent_end"' in line.replace(' ', ''):
        break
print('tool surface includes implementer:', seen)
proc.terminate()
proc.wait(timeout=10)
PY
```

Expected output includes:

```text
config roles: ['capable', 'cheap', 'implementer', 'standard']
tool surface includes implementer: True
```

- [ ] **Step 4: Verify packaged agent runtime mapping**

Run:

```bash
python3 - <<'PY'
import ast, json, select, subprocess, time

config = json.load(open(str((__import__('pathlib').Path.home() / '.pi/agent/subagent-models.json'))))['models']
checks = [
    ('scout', 'cheap'),
    ('worker', 'implementer'),
    ('reviewer', 'standard'),
    ('planner', 'capable'),
]

for agent, role in checks:
    expected = config[role]['model']
    proc = subprocess.Popen(['pi', '--mode', 'rpc'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    proc.stdin.write(json.dumps({
        'id': '1',
        'type': 'prompt',
        'message': f'Use the subagent tool with agent="{agent}" and task="Reply with just the word {agent.upper()}OK and nothing else."'
    }) + '\n')
    proc.stdin.flush()

    actual = None
    start = time.time()
    while time.time() - start < 90:
        ready, _, _ = select.select([proc.stdout], [], [], 1.0)
        if ready:
            line = proc.stdout.readline()
            if not line:
                break
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if obj.get('type') == 'tool_execution_end' and obj.get('toolName') == 'subagent':
                result = obj.get('result')
                if isinstance(result, str):
                    try:
                        result = ast.literal_eval(result)
                    except Exception:
                        result = None
                if isinstance(result, dict):
                    actual = result.get('details', {}).get('results', [{}])[0].get('model')
                    break
        elif proc.poll() is not None:
            break

    proc.terminate()
    proc.wait(timeout=10)
    print(agent, role, expected, actual, 'PASS' if actual == expected else 'FAIL')
PY
```

Expected output:

```text
scout cheap <same-model> <same-model> PASS
worker implementer <same-model> <same-model> PASS
reviewer standard <same-model> <same-model> PASS
planner capable <same-model> <same-model> PASS
```

- [ ] **Step 5: Record review results**

Append to `tasks/todo.md`:

```md
## Follow-up Review: dedicated implementer role

- Added new role: yes/no
- Old config migrated automatically: yes/no
- Worker uses implementer role: yes/no
- Scout still uses cheap role: yes/no
- Reviewer now uses standard role: yes/no
- Planner still uses capable role: yes/no
- Notes:
  - <real verification notes>
```

- [ ] **Step 6: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add tasks/todo.md && \
  git commit -m "test: verify dedicated implementer role"
```
