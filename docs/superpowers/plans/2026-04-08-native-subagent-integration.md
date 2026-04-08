# Native Subagent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pi-tools` install Pi's subagent workflow natively from git, including the `subagent` tool, packaged fallback agents, packaged workflow prompts, and aligned documentation.

**Architecture:** Copy the official Pi subagent extension into `pi-tools`, then adapt only the resource discovery layer so the extension can load package-owned fallback agents after project and user overrides. Ship official workflow prompts as package prompts and update package docs/skills so they describe the real runtime behavior.

**Tech Stack:** TypeScript extensions for Pi, markdown-based Pi agents/prompts/skills, package manifest resources, Pi RPC mode for verification.

---

## File Structure

### New files
- `extensions/subagent/index.ts` — registers the `subagent` tool and renders single/parallel/chain execution output
- `extensions/subagent/agents.ts` — discovers agents from project, user, and packaged fallback locations in priority order
- `extensions/subagent/agents/worker.md` — packaged fallback implementation agent
- `extensions/subagent/agents/reviewer.md` — packaged fallback review agent
- `extensions/subagent/agents/planner.md` — packaged fallback planning agent
- `extensions/subagent/agents/scout.md` — packaged fallback scouting agent
- `prompts/implement.md` — packaged workflow prompt for scout → planner → worker
- `prompts/scout-and-plan.md` — packaged workflow prompt for scout → planner
- `prompts/implement-and-review.md` — packaged workflow prompt for worker → reviewer → worker

### Modified files
- `package.json` — expose prompts in the package manifest
- `README.md` — describe native subagent support, packaged agents, and prompts
- `skills/using-superpowers/SKILL.md` — remove stale statement that Pi lacks subagent support
- `skills/subagent-driven-development/SKILL.md` — document that this package provides packaged fallback agents and the `subagent` tool
- `skills/dispatching-parallel-agents/SKILL.md` — document packaged fallback agents and package-native subagent support
- `tasks/todo.md` — task tracking and review notes

### Verification helpers
- No permanent test files are required.
- Verification will use Pi RPC mode plus `get_commands` and prompt/subagent smoke tests from the installed package.

---

### Task 1: Add packaged subagent extension and fallback agents

**Files:**
- Create: `extensions/subagent/index.ts`
- Create: `extensions/subagent/agents.ts`
- Create: `extensions/subagent/agents/worker.md`
- Create: `extensions/subagent/agents/reviewer.md`
- Create: `extensions/subagent/agents/planner.md`
- Create: `extensions/subagent/agents/scout.md`
- Modify: `package.json`

- [ ] **Step 1: Write the failing verification command**

Run this command before adding the extension to confirm the repo does not yet expose packaged subagent resources:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && test -f extensions/subagent/index.ts && echo present || echo missing
```

Expected: `missing`

- [ ] **Step 2: Add the packaged fallback agent files**

Create `extensions/subagent/agents/worker.md` with:

```md
---
name: worker
description: General-purpose subagent with full capabilities, isolated context
model: claude-sonnet-4-5
---

You are a worker agent with full capabilities. You operate in an isolated context window to handle delegated tasks without polluting the main conversation.

Work autonomously to complete the assigned task. Use all available tools as needed.

Output format when finished:

## Completed
What was done.

## Files Changed
- `path/to/file.ts` - what changed

## Notes (if any)
Anything the main agent should know.

If handing off to another agent (e.g. reviewer), include:
- Exact file paths changed
- Key functions/types touched (short list)
```

Create `extensions/subagent/agents/reviewer.md` with:

```md
---
name: reviewer
description: Code review specialist for quality and security analysis
tools: read, grep, find, ls, bash
model: claude-sonnet-4-5
---

You are a senior code reviewer. Analyze code for quality, security, and maintainability.

Bash is for read-only commands only: `git diff`, `git log`, `git show`. Do NOT modify files or run builds.
Assume tool permissions are not perfectly enforceable; keep all bash usage strictly read-only.

Strategy:
1. Run `git diff` to see recent changes (if applicable)
2. Read the modified files
3. Check for bugs, security issues, code smells

Output format:

## Files Reviewed
- `path/to/file.ts` (lines X-Y)

## Critical (must fix)
- `file.ts:42` - Issue description

## Warnings (should fix)
- `file.ts:100` - Issue description

## Suggestions (consider)
- `file.ts:150` - Improvement idea

## Summary
Overall assessment in 2-3 sentences.

Be specific with file paths and line numbers.
```

Create `extensions/subagent/agents/planner.md` with:

```md
---
name: planner
description: Creates implementation plans from context and requirements
tools: read, grep, find, ls
model: claude-sonnet-4-5
---

You are a planning specialist. You receive context (from a scout) and requirements, then produce a clear implementation plan.

You must NOT make any changes. Only read, analyze, and plan.

Input format you'll receive:
- Context/findings from a scout agent
- Original query or requirements

Output format:

## Goal
One sentence summary of what needs to be done.

## Plan
Numbered steps, each small and actionable:
1. Step one - specific file/function to modify
2. Step two - what to add/change
3. ...

## Files to Modify
- `path/to/file.ts` - what changes
- `path/to/other.ts` - what changes

## New Files (if any)
- `path/to/new.ts` - purpose

## Risks
Anything to watch out for.

Keep the plan concrete. The worker agent will execute it verbatim.
```

Create `extensions/subagent/agents/scout.md` with:

```md
---
name: scout
description: Fast codebase recon that returns compressed context for handoff to other agents
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase and return structured findings that another agent can use without re-reading everything.

Your output will be passed to an agent who has NOT seen the files you explored.

Thoroughness (infer from task, default medium):
- Quick: Targeted lookups, key files only
- Medium: Follow imports, read critical sections
- Thorough: Trace all dependencies, check tests/types

Strategy:
1. grep/find to locate relevant code
2. Read key sections (not entire files)
3. Identify types, interfaces, key functions
4. Note dependencies between files

Output format:

## Files Retrieved
List with exact line ranges:
1. `path/to/file.ts` (lines 10-50) - Description of what's here
2. `path/to/other.ts` (lines 100-150) - Description
3. ...

## Key Code
Critical types, interfaces, or functions:

```typescript
interface Example {
  // actual code from the files
}
```

```typescript
function keyFunction() {
  // actual implementation
}
```

## Architecture
Brief explanation of how the pieces connect.

## Start Here
Which file to look at first and why.
```

- [ ] **Step 3: Add the discovery module with packaged fallback support**

Create `extensions/subagent/agents.ts` with:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "project" | "user" | "package";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
  userAgentsDir: string;
  packageAgentsDir: string;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_AGENTS_DIR = path.join(MODULE_DIR, "agents");

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((tool: string) => tool.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userAgentsDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const packageAgents = loadAgentsFromDir(PACKAGE_AGENTS_DIR, "package");
  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userAgentsDir, "user");
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();

  for (const agent of packageAgents) agentMap.set(agent.name, agent);
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  return {
    agents: Array.from(agentMap.values()),
    projectAgentsDir,
    userAgentsDir,
    packageAgentsDir: PACKAGE_AGENTS_DIR,
  };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
    remaining,
  };
}
```

- [ ] **Step 4: Add the subagent extension implementation**

Copy the official Pi example file into `extensions/subagent/index.ts` and keep its logic intact, with exactly these package-facing edits:

1. Keep the import:
```ts
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.js";
```

2. Update `SingleResult` so `agentSource` supports packaged agents:
```ts
agentSource: "user" | "project" | "package" | "unknown";
```

3. In the tool description, replace the two scope lines with:
```ts
'Default agent scope is "user" (user agents plus packaged fallbacks).',
'Use agentScope: "both" to allow project-local overrides from .pi/agents.',
```

4. Where the invalid-parameter path formats available agents, keep:
```ts
const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
```

All other logic should stay aligned with the official Pi example so future diffing against upstream remains easy.

- [ ] **Step 5: Expose the extension directory through the package manifest**

Update `package.json` so the `pi` section remains valid and continues exposing extensions and skills. After this task it should still contain:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  }
}
```

No extra manifest change is required yet beyond keeping `extensions/subagent/` under the already-exported `./extensions` path.

- [ ] **Step 6: Run a file-presence verification**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  test -f extensions/subagent/index.ts && \
  test -f extensions/subagent/agents.ts && \
  test -f extensions/subagent/agents/worker.md && \
  test -f extensions/subagent/agents/reviewer.md && \
  test -f extensions/subagent/agents/planner.md && \
  test -f extensions/subagent/agents/scout.md
```

Expected: command exits successfully with no output.

- [ ] **Step 7: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add package.json extensions/subagent && \
  git commit -m "feat: add packaged subagent extension"
```

---

### Task 2: Add packaged workflow prompts and align package docs/skills

**Files:**
- Create: `prompts/implement.md`
- Create: `prompts/scout-and-plan.md`
- Create: `prompts/implement-and-review.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `skills/using-superpowers/SKILL.md`
- Modify: `skills/subagent-driven-development/SKILL.md`
- Modify: `skills/dispatching-parallel-agents/SKILL.md`

- [ ] **Step 1: Write the failing verification command**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && test -d prompts && echo present || echo missing
```

Expected: `missing`

- [ ] **Step 2: Add the packaged prompt templates**

Create `prompts/implement.md` with:

```md
---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "planner" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)
3. Finally, use the "worker" agent to implement the plan from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
```

Create `prompts/scout-and-plan.md` with:

```md
---
description: Scout gathers context, planner creates implementation plan (no implementation)
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "scout" agent to find all code relevant to: $@
2. Then, use the "planner" agent to create an implementation plan for "$@" using the context from the previous step (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}. Do NOT implement - just return the plan.
```

Create `prompts/implement-and-review.md` with:

```md
---
description: Worker implements, reviewer reviews, worker applies feedback
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "worker" agent to implement: $@
2. Then, use the "reviewer" agent to review the implementation from the previous step (use {previous} placeholder)
3. Finally, use the "worker" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.
```

- [ ] **Step 3: Expose prompts in the package manifest**

Update `package.json` so the `pi` section becomes:

```json
"pi": {
  "extensions": ["./extensions"],
  "skills": ["./skills"],
  "prompts": ["./prompts"]
}
```

- [ ] **Step 4: Update the README to describe native subagent support**

Edit `README.md` so it adds a new section after "Extension: Subagent Models":

```md
### Extension: Subagent

Provides Pi's native `subagent` tool directly from this package.

Included resources:
- `subagent` tool with single, parallel, and chain modes
- Packaged fallback agents: `worker`, `reviewer`, `planner`, `scout`
- Workflow prompts:
  - `/implement`
  - `/scout-and-plan`
  - `/implement-and-review`

Agent resolution priority:
1. Project-local `.pi/agents`
2. User-level `~/.pi/agent/agents`
3. Packaged fallback agents from this package
```

Also update the opening paragraph to mention native subagent support:

```md
A pi package with my personal toolkit: native subagent support, extension for subagent model configuration, brainstorming workflows, systematic debugging, Rust review/perf, and more.
```

- [ ] **Step 5: Remove stale non-subagent guidance from `using-superpowers`**

Replace this sentence in `skills/using-superpowers/SKILL.md`:

```md
Skills were originally written for Claude Code. In pi, use the `read` tool for loading skills/files, `bash` for running commands, `edit` for file changes, and `write` for creating files. Pi does not have a `Task` tool for subagents — execute tasks sequentially instead, or use bash to run background processes.
```

with:

```md
Skills were originally written for Claude Code. In pi, use the `read` tool for loading skills/files, `bash` for running commands, `edit` for file changes, and `write` for creating files. When the native `subagent` extension is installed, use it for isolated subagent workflows; otherwise adapt skills to sequential execution or other Pi-native mechanisms.
```

- [ ] **Step 6: Align subagent-specific skills with packaged fallback agents**

In `skills/subagent-driven-development/SKILL.md`, replace:

```md
# The subagent extension uses agent definitions (~/.pi/agent/agents/*.md)
# which have model configured in their frontmatter.
# Use worker agent for implementation, reviewer agent for reviews.
```

with:

```md
# The subagent extension uses agent definitions from project-local .pi/agents,
# then ~/.pi/agent/agents, then packaged fallback agents when available.
# Use worker agent for implementation, reviewer agent for reviews.
```

In `skills/dispatching-parallel-agents/SKILL.md`, replace:

```md
Default agents from `~/.pi/agent/agents/`:
```

with:

```md
Default agents come from project-local overrides, user agents, or packaged fallback agents:
```

and replace:

```md
Project-local agents: `.pi/agents/*.md` (requires `agentScope: "project"` or `"both"`).
```

with:

```md
Project-local agents: `.pi/agents/*.md` (requires `agentScope: "project"` or `"both"`). If none override a name, packaged fallback agents from this package can satisfy the request.
```

- [ ] **Step 7: Run verification for prompt/docs presence**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  test -f prompts/implement.md && \
  test -f prompts/scout-and-plan.md && \
  test -f prompts/implement-and-review.md && \
  grep -q '"prompts": \["./prompts"\]' package.json && \
  grep -q 'Provides Pi\x27s native `subagent` tool directly from this package.' README.md
```

Expected: command exits successfully with no output.

- [ ] **Step 8: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add package.json README.md prompts skills/using-superpowers/SKILL.md skills/subagent-driven-development/SKILL.md skills/dispatching-parallel-agents/SKILL.md && \
  git commit -m "docs: align package with native subagent support"
```

---

### Task 3: Verify installed package behavior end-to-end

**Files:**
- Modify: `tasks/todo.md`

- [ ] **Step 1: Write the failing verification command**

Run this against the currently installed package before reinstalling/reloading the updated repo:

```bash
python3 - <<'PY'
import json, subprocess, sys, time
proc = subprocess.Popen(["pi", "--mode", "rpc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
proc.stdin.write(json.dumps({"id":"1","type":"get_commands"}) + "\n")
proc.stdin.flush()
line = proc.stdout.readline()
print(line.strip())
proc.terminate()
proc.wait(timeout=5)
PY
```

Expected: the JSON response does **not** yet contain prompt commands named `implement`, `scout-and-plan`, and `implement-and-review` from this package version.

- [ ] **Step 2: Reload or reinstall the updated package**

Run:

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && pi install /Users/nacho/Documents/GitHub/pi-tools
```

If Pi reports the local package is already installed, follow with:

```bash
pi update
```

- [ ] **Step 3: Verify commands include packaged prompts**

Run:

```bash
python3 - <<'PY'
import json, subprocess
proc = subprocess.Popen(["pi", "--mode", "rpc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
proc.stdin.write(json.dumps({"id":"1","type":"get_commands"}) + "\n")
proc.stdin.flush()
response = json.loads(proc.stdout.readline())
commands = response["data"]["commands"]
names = sorted(command["name"] for command in commands)
print("implement" in names, "scout-and-plan" in names, "implement-and-review" in names)
proc.terminate()
proc.wait(timeout=5)
PY
```

Expected output:

```text
True True True
```

- [ ] **Step 4: Verify the `subagent` tool works with packaged fallback agents**

Run:

```bash
python3 - <<'PY'
import json, subprocess
proc = subprocess.Popen(["pi", "--mode", "rpc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
proc.stdin.write(json.dumps({"id":"1","type":"prompt","message":"Use the subagent tool with agent \"planner\" and task \"Say only PACKAGE_OK\"."}) + "\n")
proc.stdin.flush()
found = False
for _ in range(400):
    line = proc.stdout.readline()
    if not line:
        break
    if 'PACKAGE_OK' in line or 'planner' in line and 'subagent' in line:
        found = True
    if '"type":"agent_end"' in line.replace(' ', ''):
        break
print("OK" if found else "FAIL")
proc.terminate()
proc.wait(timeout=5)
PY
```

Expected output:

```text
OK
```

- [ ] **Step 5: Verify existing model-config tooling still exists**

Run:

```bash
python3 - <<'PY'
import json, subprocess
proc = subprocess.Popen(["pi", "--mode", "rpc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
proc.stdin.write(json.dumps({"id":"1","type":"prompt","message":"Call the get_subagent_models tool."}) + "\n")
proc.stdin.flush()
seen = False
for _ in range(400):
    line = proc.stdout.readline()
    if not line:
        break
    if 'cheap' in line and 'standard' in line and 'capable' in line:
        seen = True
    if '"type":"agent_end"' in line.replace(' ', ''):
        break
print("OK" if seen else "FAIL")
proc.terminate()
proc.wait(timeout=5)
PY
```

Expected output:

```text
OK
```

- [ ] **Step 6: Update task tracking with review notes**

Append this section to `tasks/todo.md`, filling in the real results from the commands above:

```md
## Review

- Installed/reloaded updated package: yes/no
- Prompt commands verified: yes/no
- Subagent packaged fallback smoke test: yes/no
- Existing model config tools still work: yes/no
- Notes:
  - <real verification notes>
```

- [ ] **Step 7: Commit**

```bash
cd /Users/nacho/Documents/GitHub/pi-tools && \
  git add tasks/todo.md && \
  git commit -m "test: verify native subagent package integration"
```
