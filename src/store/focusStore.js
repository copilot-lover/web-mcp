import { create } from 'zustand';
import { TASKS, DEMO_CONTEXT } from '../data/demoTasks.js';

// Helper to generate IDs
let nextId = 1;
const genId = () => `fb-${nextId++}`;

// --- Capacity: how much of an ordered task list fits in the available time. ---
// Walks the list accumulating estimatedMinutes; the first K tasks whose
// cumulative time <= availableMinutes "fit", the rest overflow. This is what
// makes available time *meaningfully* change the recommendation's scope — not
// just a number, but how much of the plan is actually doable today.
function computeCapacity(tasks, orderedTaskIds, availableMinutes) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const fitsTaskIds = [];
  const overflowTaskIds = [];
  let fitsMinutes = 0;
  let totalMinutes = 0;
  for (const id of orderedTaskIds || []) {
    const t = byId.get(id);
    const mins = t ? (t.estimatedMinutes || 0) : 0;
    totalMinutes += mins;
    if (fitsMinutes + mins <= availableMinutes) {
      fitsMinutes += mins;
      fitsTaskIds.push(id);
    } else {
      overflowTaskIds.push(id);
    }
  }
  return {
    totalMinutes,
    fitsMinutes,
    overflowMinutes: totalMinutes - fitsMinutes,
    fitsCount: fitsTaskIds.length,
    overflowCount: overflowTaskIds.length,
    fitsTaskIds,
    overflowTaskIds,
  };
}

// Downstream chain via BFS (prereq -> dependent), preserving the order used
// across propose / restructure / completion.
function getDownstreamChain(tasks, startTaskId) {
  const visited = new Set();
  const queue = [startTaskId];
  const result = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    tasks.filter((t) => t.dependencies.includes(current)).forEach((t) => {
      if (!visited.has(t.id)) queue.push(t.id);
    });
  }
  return result;
}

const STORAGE_KEY_MINUTES = "focus:defaultMinutes";
const storedDefault = (() => {
  try { const v = Number(localStorage.getItem(STORAGE_KEY_MINUTES)); return Number.isFinite(v) && v >= 15 ? v : null; } catch { return null; }
})();

const useFocusStore = create((set, get) => ({
  // State
  tasks: JSON.parse(JSON.stringify(TASKS)),
  availableMinutes: storedDefault ?? DEMO_CONTEXT.availableMinutes,
  defaultAvailableMinutes: storedDefault ?? DEMO_CONTEXT.availableMinutes,
  overloadLevel: DEMO_CONTEXT.overloadLevel,
  currentProposal: null,
  activeFocusBlock: null,
  stateVersion: 0,
  bottleneckTaskId: null,

  // Mutations — every one increments stateVersion
  incrementVersion: () => set((s) => ({ stateVersion: s.stateVersion + 1 })),

  setTasks: (tasks) => set({ tasks, stateVersion: get().stateVersion + 1 }),

  setOverloadLevel: (level) => set({ overloadLevel: level, stateVersion: get().stateVersion + 1 }),

  // --- Available time: the single lever that re-plans scope. ---
  // Changing time re-assesses overload and re-computes the fit/overflow split
  // on any existing proposal, so the recommendation's scope visibly reacts.
  setAvailableMinutes: (minutes) => {
    const s = get();
    const safe = Math.max(15, Math.round(Number(minutes) || 0));
    set({ availableMinutes: safe, stateVersion: s.stateVersion + 1 });
    get().assessOverload();
    const prop = get().currentProposal;
    if (prop && Array.isArray(prop.orderedTaskIds)) {
      const capacity = computeCapacity(get().tasks, prop.orderedTaskIds, safe);
      set({ currentProposal: { ...prop, capacity }, stateVersion: get().stateVersion + 1 });
    }
    return get().stateVersion;
  },

  // Persist the current availableMinutes as the default for next load.
  setDefaultMinutes: (minutes) => {
    const safe = Math.max(15, Math.round(Number(minutes) || 0));
    try { localStorage.setItem(STORAGE_KEY_MINUTES, String(safe)); } catch {}
    set({ defaultAvailableMinutes: safe, availableMinutes: safe, stateVersion: get().stateVersion + 1 });
    get().assessOverload();
    const prop = get().currentProposal;
    if (prop && Array.isArray(prop.orderedTaskIds)) {
      const capacity = computeCapacity(get().tasks, prop.orderedTaskIds, safe);
      set({ currentProposal: { ...prop, capacity }, stateVersion: get().stateVersion + 1 });
    }
    return get().stateVersion;
  },

  resetToDefaultMinutes: () => {
    const safe = get().defaultAvailableMinutes ?? DEMO_CONTEXT.availableMinutes;
    return get().setAvailableMinutes(safe);
  },

  setBottleneckTaskId: (id) => set({ bottleneckTaskId: id, stateVersion: get().stateVersion + 1 }),

  proposePlan: (proposal) => {
    const capacity = computeCapacity(get().tasks, proposal.orderedTaskIds, get().availableMinutes);
    set({ currentProposal: { ...proposal, capacity }, stateVersion: get().stateVersion + 1 });
  },

  clearProposal: () => set({ currentProposal: null, stateVersion: get().stateVersion + 1 }),

  startFocusBlock: (taskId, durationMinutes) => set({
    activeFocusBlock: {
      id: genId(),
      taskId,
      durationMinutes,
      status: "active",
      startedAt: new Date().toISOString(),
    },
    stateVersion: get().stateVersion + 1,
  }),

  // Complete the block, mark the task done (when completed), and advance the
  // plan to the next task — the repeated loop. Returns structured next-task
  // info so both the UI and a WebMCP agent can continue from the new state.
  //
  // NOTE: computed with get() then returned directly (Zustand's set() returns
  // nothing), so the structured result is available to the caller/tool.
  completeFocusBlock: (result) => {
    const s = get();
    const block = s.activeFocusBlock;
    if (!block || block.status !== "active") {
      return { status: "error", code: "NO_ACTIVE_BLOCK", stateVersion: s.stateVersion };
    }

    const startedAt = new Date(block.startedAt).getTime();
    const elapsedMinutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));

    // "completed" / "partially_completed" finish the task; "abandoned" does not.
    const didComplete = result === "completed" || result === "partially_completed";
    const tasks = didComplete
      ? s.tasks.map((t) => (t.id === block.taskId ? { ...t, status: "completed" } : t))
      : s.tasks;

    // Next task = the next incomplete/idle task after this one in the plan's
    // ordered sequence.
    const remainingIds = (s.currentProposal?.orderedTaskIds || []).filter((id) => id !== block.taskId);
    const nextTaskId = remainingIds.find((id) => {
      const t = tasks.find((x) => x.id === id);
      return t && t.status !== "completed" && t.status !== "deferred";
    }) || null;

    let currentProposal = s.currentProposal;
    if (didComplete) {
      if (nextTaskId) {
        const chain = getDownstreamChain(tasks, nextTaskId);
        const capacity = computeCapacity(tasks, chain, s.availableMinutes);
        currentProposal = {
          id: "proposal-1",
          primaryTaskId: nextTaskId,
          orderedTaskIds: chain,
          rationale: ["next in sequence"],
          confidence: 0.85,
          requiresApproval: true,
          capacity,
        };
      } else {
        currentProposal = null; // nothing left — plan complete
      }
    }

    // Keep the block object (status transition 'active' -> result) so the
    // ActivityRail still detects "block completed"/"block abandoned"; FocusMode
    // closes because status !== 'active'.
    const finishedBlock = { ...block, status: result };

    // Recompute overload against the updated task list.
    const activeCount = tasks.filter((t) => t.status === "backlog").length;
    const deadlines = tasks.filter((t) => t.dueAt && t.status !== "completed" && t.status !== "deferred").length;
    const totalMinutes = tasks.filter((t) => t.status === "backlog").reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
    const capacityRatio = totalMinutes / Math.max(s.availableMinutes, 1);
    let overloadLevel = "low";
    if (capacityRatio >= 3 || deadlines > 5) overloadLevel = "high";
    else if (capacityRatio >= 2 || deadlines > 3) overloadLevel = "medium";

    set({
      tasks,
      activeFocusBlock: finishedBlock,
      currentProposal,
      bottleneckTaskId: didComplete ? (nextTaskId || null) : s.bottleneckTaskId,
      overloadLevel,
      stateVersion: s.stateVersion + 1,
    });

    const completedTask = s.tasks.find((t) => t.id === block.taskId);
    const nextTask = nextTaskId ? tasks.find((t) => t.id === nextTaskId) : null;
    const unlocks = nextTaskId
      ? tasks.filter((t) => t.dependencies.includes(nextTaskId)).map((t) => ({ id: t.id, title: t.title }))
      : [];

    return {
      status: "completed",
      completedTaskId: block.taskId,
      completedTaskTitle: completedTask?.title || null,
      result,
      elapsedMinutes,
      nextTask: nextTask
        ? { id: nextTask.id, title: nextTask.title, durationMinutes: nextTask.estimatedMinutes, unlocks }
        : null,
      allDone: didComplete && !nextTaskId,
      overloadLevel,
      activeCount,
      totalMinutes,
      stateVersion: get().stateVersion,
    };
  },

  // Override/replan helpers
  overridePrimary: (taskId) => {
    const s = get();
    if (!s.currentProposal) return;
    const newOrder = [taskId, ...s.currentProposal.orderedTaskIds.filter((id) => id !== taskId)];
    const capacity = computeCapacity(s.tasks, newOrder, s.availableMinutes);
    set({
      currentProposal: { ...s.currentProposal, primaryTaskId: taskId, orderedTaskIds: newOrder, capacity },
      stateVersion: s.stateVersion + 1,
    });
  },

  // Reorder the proposal's sequence (used by restructure_plan) — keeps the
  // capacity split in sync with the new order.
  setProposalOrder: (orderedTaskIds) => {
    const prop = get().currentProposal;
    if (!prop) return;
    const capacity = computeCapacity(get().tasks, orderedTaskIds, get().availableMinutes);
    set({ currentProposal: { ...prop, orderedTaskIds, capacity }, stateVersion: get().stateVersion + 1 });
  },

  restructureDependencies: (taskId, newDependencies) => set((s) => ({
    tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, dependencies: newDependencies } : t)),
    stateVersion: s.stateVersion + 1,
  })),

  deferTask: (taskId) => set((s) => ({
    tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: "deferred" } : t)),
    stateVersion: s.stateVersion + 1,
  })),

  // --- Task CRUD for the clean list (add/toggle/update/remove) ---
  addTask: ({ title, estimatedMinutes = 25, priority = "medium", dueAt = null, dependencies = [], tags = [] }) => {
    const clean = String(title || "").trim();
    if (!clean) return { status: "error", code: "EMPTY_TITLE" };
    const mins = Math.max(5, Math.min(480, Math.round(Number(estimatedMinutes) || 25)));
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTask = {
      id,
      title: clean,
      priority: ["critical", "high", "medium", "low"].includes(priority) ? priority : "medium",
      status: "backlog",
      estimatedMinutes: mins,
      dueAt: dueAt || null,
      dependencies: Array.isArray(dependencies) ? dependencies.filter(Boolean) : [],
      tags: Array.isArray(tags) ? tags : [],
    };
    const tasks = [...get().tasks, newTask];
    set({ tasks, stateVersion: get().stateVersion + 1 });
    get().assessOverload();
    // keep capacity in sync if a proposal exists
    const prop = get().currentProposal;
    if (prop && Array.isArray(prop.orderedTaskIds)) {
      const capacity = computeCapacity(tasks, prop.orderedTaskIds, get().availableMinutes);
      set({ currentProposal: { ...prop, capacity }, stateVersion: get().stateVersion + 1 });
    }
    return { status: "created", task: newTask, stateVersion: get().stateVersion };
  },

  toggleTask: (taskId) => {
    const s = get();
    const t = s.tasks.find((x) => x.id === taskId);
    if (!t) return { status: "error", code: "TASK_NOT_FOUND" };
    const nextStatus = t.status === "completed" ? "backlog" : "completed";
    const tasks = s.tasks.map((x) => (x.id === taskId ? { ...x, status: nextStatus } : x));
    set({ tasks, stateVersion: s.stateVersion + 1 });
    get().assessOverload();
    const prop = get().currentProposal;
    if (prop && Array.isArray(prop.orderedTaskIds)) {
      const capacity = computeCapacity(tasks, prop.orderedTaskIds, get().availableMinutes);
      set({ currentProposal: { ...prop, capacity }, stateVersion: get().stateVersion + 1 });
    }
    return { status: "toggled", taskId, nextStatus, stateVersion: get().stateVersion };
  },

  updateTask: (taskId, patch) => {
    const s = get();
    if (!s.tasks.some((t) => t.id === taskId)) return { status: "error", code: "TASK_NOT_FOUND" };
    const tasks = s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
    set({ tasks, stateVersion: s.stateVersion + 1 });
    get().assessOverload();
    return { status: "updated", taskId, stateVersion: get().stateVersion };
  },

  removeTask: (taskId) => {
    const s = get();
    const tasks = s.tasks.filter((t) => t.id !== taskId);
    // also strip it from any dependencies
    const cleaned = tasks.map((t) => ({ ...t, dependencies: (t.dependencies || []).filter((d) => d !== taskId) }));
    let currentProposal = s.currentProposal;
    if (currentProposal && Array.isArray(currentProposal.orderedTaskIds) && currentProposal.orderedTaskIds.includes(taskId)) {
      const nextIds = currentProposal.orderedTaskIds.filter((id) => id !== taskId);
      if (nextIds.length === 0) currentProposal = null;
      else {
        const capacity = computeCapacity(cleaned, nextIds, s.availableMinutes);
        currentProposal = { ...currentProposal, orderedTaskIds: nextIds, primaryTaskId: nextIds[0] || null, capacity };
      }
    }
    set({ tasks: cleaned, currentProposal, stateVersion: s.stateVersion + 1 });
    get().assessOverload();
    return { status: "removed", taskId, stateVersion: get().stateVersion };
  },

  // Assessment helper — overload now reflects capacity: total active minutes vs
  // available time, so a smaller window genuinely reads as more overloaded.
  assessOverload: () => {
    const s = get();
    const activeTasks = s.tasks.filter((t) => t.status === "backlog");
    const activeCount = activeTasks.length;
    const deadlines = s.tasks.filter((t) => t.dueAt && t.status !== "completed" && t.status !== "deferred").length;
    const totalMinutes = activeTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
    const capacityRatio = totalMinutes / Math.max(s.availableMinutes, 1);
    let level = "low";
    if (capacityRatio >= 3 || deadlines > 5) level = "high";
    else if (capacityRatio >= 2 || deadlines > 3) level = "medium";
    set({ overloadLevel: level, stateVersion: s.stateVersion + 1 });
    return {
      status: level,
      taskCount: activeCount,
      deadlineCount: deadlines,
      availableMinutes: s.availableMinutes,
      totalMinutes,
      capacityRatio: Math.round(capacityRatio * 10) / 10,
      stateVersion: get().stateVersion,
    };
  },

  // Identify bottleneck — finds task with most downstream dependents + closest deadline
  identifyBottleneck: () => {
    const s = get();
    // Build dependency tree (which tasks depend on which)
    const downstreamMap = {};
    s.tasks.filter((t) => t.status !== "completed" && t.status !== "deferred").forEach((t) => {
      t.dependencies.forEach((depId) => {
        if (!downstreamMap[depId]) downstreamMap[depId] = [];
        downstreamMap[depId].push(t.id);
      });
    });

    let bottleneck = null;
    let bestScore = -1;
    const now = new Date();

    s.tasks.filter((t) => t.status !== "completed" && t.status !== "deferred").forEach((t) => {
      const downstream = downstreamMap[t.id]?.length || 0;
      const urgency = t.dueAt ? (new Date(t.dueAt) - now) / 3600000 : 168;
      const priorityScore = t.priority === "critical" ? 5 : t.priority === "high" ? 3 : t.priority === "medium" ? 1 : 0;
      const score = downstream * 3 + (100 / Math.max(urgency, 0.1)) + priorityScore * 2;

      if (score > bestScore) {
        bestScore = score;
        bottleneck = t.id;
      }
    });

    set({ bottleneckTaskId: bottleneck, stateVersion: s.stateVersion + 1 });
    return bottleneck;
  },
}));

export default useFocusStore;
