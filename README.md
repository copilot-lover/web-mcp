# FOCUS — Cognitive Command Center

> Turn overwhelm into one clear next action.

FOCUS is a WebMCP-native executive-function command center for moments of cognitive overload. It lets an AI agent inspect your live workload, propose a plan, accept human corrections, recompute the plan, and enter focused execution — all through typed, intent-level tools exposed directly by the application.

---

## Why WebMCP is the right fit

Cognitive overload is fundamentally a *state* problem. The user's tasks, deadlines, dependencies, and available time exist as a structured graph inside the application. A chatbot sitting beside a to-do list can't inspect this graph — it has no access to the dependency relationships, the bottleneck analysis, or the proposal state. WebMCP is the only bridge that gives the agent typed, structured access to this live application state.

Every tool FOCUS exposes is an *intent-level action* — not a UI primitive. The agent doesn't click buttons or fill forms. It calls `identify_bottleneck()` and receives the exact task that blocks the most downstream work. It calls `override_plan()` and the application recomputes the entire dependency chain.

## How it creates a better experience

Traditional productivity tools assume the user can already decide what to do next. That assumption breaks under overload. FOCUS changes the interaction from *user decides, uses tool to execute* to *agent proposes, human overrides, agent recomputes, human approves, execution begins*.

This is what human-agent collaboration actually looks like. The agent does the analysis and proposes. The human commands. No consequential action happens without consent.

## What people and agents can now do together

Before WebMCP, this workflow would have required brittle DOM scraping, serialized UI state, or a custom backend bridge. The agent couldn't inspect the dependency graph, couldn't detect staleness, couldn't receive structured error responses when its state was out of date.

Now an agent and human can negotiate a plan together in a tight loop:

1. Agent reads the live workload through `get_workload_state`
2. Agent assesses overload and identifies the bottleneck through `assess_overload` + `identify_bottleneck`
3. Agent proposes a focus block through `propose_focus_block`
4. Human overrides through `override_plan` — the agent recomputes dependencies via `restructure_plan`
5. Human physically approves in the UI — the agent can then confirm via `start_focus_block`
6. Agent records the outcome through `complete_focus_block`

## Tool Surface & Data Schema

FOCUS registers 11 WebMCP tools in three operation classes. All mutation tools carry `expectedStateVersion` for stale-state detection and return `stateVersion` in responses. The application's zustand store (module-level singleton) exposes it via dynamic import.

### Read Tools (agent executes freely)

| Tool | Returns | Input Schema |
|------|---------|-------------|
| `get_workload_state` | `{ tasks[], availableMinutes, overloadLevel, currentProposal?, activeFocusBlock?, stateVersion }` | `{}` |
| `get_task_dependencies` | `{ taskId, dependsOn, blockedTasks, stateVersion }` or `{ relationships[], stateVersion }` | `{ taskId?: string }` |
| `get_available_time` | `{ availableMinutes, windows[], stateVersion }` | `{}` |
| `assess_overload` | `{ status, taskCount, deadlineCount, availableMinutes, bottleneckTaskId, stateVersion }` | `{}` |
| `identify_bottleneck` | `{ bottleneckTaskId, task, downstreamChain[], stateVersion }` | `{}` |

### Proposal Tools (human override available)

| Tool | Returns | Input Schema |
|------|---------|-------------|
| `propose_focus_block` | `{ status: "proposed", proposal, stateVersion }` | `{ taskId: string, durationMinutes: number, reason?: string, expectedStateVersion?: number }` |
| `override_plan` | `{ status: "override_applied", previousPrimaryTask, newPrimaryTask, orderedTaskIds[], stateVersion }` | `{ taskId: string, reason?: string, expectedStateVersion?: number }` |
| `restructure_plan` | `{ status: "restructured", previousOrder[], newOrder[], stateVersion }` | `{ expectedStateVersion?: number }` |
| `defer_task` | `{ status: "deferred", taskId, stateVersion }` | `{ taskId: string, expectedStateVersion?: number }` |

### Consequential Tools (human must approve)

| Tool | Returns | Input Schema |
|------|---------|-------------|
| `start_focus_block` | `{ status: "active", taskId, durationMinutes, startedAt, stateVersion }` or `{ code: "HUMAN_APPROVAL_REQUIRED", ... }` | `{ taskId?: string, durationMinutes?: number, expectedStateVersion?: number }` |
| `complete_focus_block` | `{ status: "completed", taskId, result, elapsedMinutes, stateVersion }` | `{ result: "completed"|"partially_completed"|"abandoned", expectedStateVersion?: number }` |

### Error Response Schema

```json
{
  "status": "error",
  "code": "STALE_STATE",
  "message": "The workload has changed since your last read.",
  "currentStateVersion": 5,
  "expectedStateVersion": 3
}
```

Error codes: `STALE_STATE` (version mismatch), `TASK_NOT_FOUND` (invalid taskId), `NO_ACTIVE_PROPOSAL` (no proposal to override/restructure), `NO_ACTIVE_BLOCK` (no focus block to complete), `HUMAN_APPROVAL_REQUIRED` (UI button not clicked), `TASK_MISMATCH` (taskId doesn't match active block).

## How WebMCP is implemented

FOCUS uses the standard WebMCP polyfill (`/webmcp-polyfill.js`, copied from the shared polyfill at `webmcp-tools/demos/shared/webmcp-polyfill.js` for Vite compatibility). On page load, `main.jsx` imports `registerTools.js` which calls `document.modelContext.registerTool()` for each of the 11 tools.

The application is built with **React 19 + Vite + Zustand**. The zustand store is a module-level singleton, so tool executors can access it:

```js
const { default: store } = await import('../store/focusStore.js');
const s = store.getState();
```

Every store mutation increments `stateVersion`. Tools accept `expectedStateVersion` and reject with `STALE_STATE` if the version has changed since the agent last read — preventing lost-update conflicts.

## State Schema

The zustand store holds:

```typescript
interface Task {
  id: string; title: string; priority: "critical"|"high"|"medium"|"low";
  status: "backlog"|"active"|"completed"|"deferred";
  estimatedMinutes: number; dueAt?: string; dependencies: string[];
}

interface PlanProposal {
  id: string; primaryTaskId: string; orderedTaskIds: string[];
  rationale: string[]; confidence: number; requiresApproval: boolean;
}

interface FocusBlock {
  id: string; taskId: string; durationMinutes: number;
  status: "proposed"|"approved"|"active"|"completed"|"abandoned";
  startedAt?: string;
}
```

## Architecture

```
focus/
├── src/
│   ├── App.jsx                        # Root layout — composes all components
│   ├── components/
│   │   ├── CognitiveMap/              # SVG task dependency graph
│   │   ├── StartHere/                 # START HERE intervention card
│   │   ├── PlanTimeline/              # Ordered execution sequence
│   │   ├── FocusMode/                 # Full-screen focus overlay
│   │   └── ActivityRail/              # Agent activity feed
│   ├── store/
│   │   └── focusStore.js              # Zustand store with stateVersion
│   └── webmcp/
│       └── registerTools.js           # All 11 WebMCP tool registrations
├── index.html
├── package.json
└── vite.config.js
```

## Running

```bash
cd webmcp-tools/demos/focus
npm install
npm run dev
```

Requires a Chromium-based browser with WebMCP support (Chrome 149+ with origin trial `WebModelContextAccess` enabled via `--enable-features=WebModelContextAccess` or `chrome://flags/#web-model-context-access`).

---

*Built for the 2026 WebMCP Hackathon.*