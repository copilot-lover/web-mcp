// Must load AFTER polyfill (polyfill adds document.modelContext)
const ctx = document.modelContext;
if (!ctx) {
  console.warn("FOCUS: WebMCP context not available");
} else {
  ctx.registerTool({
    name: "get_workload_state",
    description: "Returns the user's current workload, available time, active tasks, deadlines, and dependency relationships so an agent can help prioritize the next action.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();
      return {
        content: [{ type: "text", text: JSON.stringify({
          tasks: s.tasks,
          availableMinutes: s.availableMinutes,
          overloadLevel: s.overloadLevel,
          totalActiveMinutes: s.tasks.filter(t => t.status === "backlog").reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0),
          currentProposal: s.currentProposal ?? null,
          activeFocusBlock: s.activeFocusBlock ?? null,
          stateVersion: s.stateVersion,
        })}]
      };
    },
  });

  ctx.registerTool({
    name: "get_task_dependencies",
    description: "Returns the dependency relationships for a specific task or all tasks — upstream tasks this depends on and downstream tasks that depend on this.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Optional task ID to get dependencies for. Returns all if omitted." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      if (args?.taskId) {
        const task = s.tasks.find(t => t.id === args.taskId);
        if (!task) return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found" }) }] };
        const downstream = s.tasks.filter(t => t.dependencies.includes(args.taskId)).map(t => t.id);
        return { content: [{ type: "text", text: JSON.stringify({
          taskId: args.taskId,
          dependsOn: task.dependencies,
          blockedTasks: downstream,
          stateVersion: s.stateVersion,
        })}] };
      }

      const relationships = s.tasks.map(t => ({
        taskId: t.id,
        title: t.title,
        dependsOn: t.dependencies,
        blockedByDependencyOf: s.tasks.filter(dt => t.dependencies.includes(dt.id)).map(dt => dt.title),
        blockedTasks: s.tasks.filter(dt => dt.dependencies.includes(t.id)).map(dt => dt.id),
        blockedTaskTitles: s.tasks.filter(dt => dt.dependencies.includes(t.id)).map(dt => dt.title),
      }));
      return { content: [{ type: "text", text: JSON.stringify({ relationships, stateVersion: s.stateVersion }) }] };
    },
  });

  ctx.registerTool({
    name: "get_available_time",
    description: "Returns the user's available time windows for focused work today.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();
      return { content: [{ type: "text", text: JSON.stringify({
        availableMinutes: s.availableMinutes,
        windows: [{ start: "now", durationMinutes: s.availableMinutes }],
        stateVersion: s.stateVersion,
      })}] };
    },
  });

  ctx.registerTool({
    name: "set_available_time",
    description: "Sets the user's available focused-work time for today (in minutes) and re-plans scope: overload and the fit/overflow split on any active proposal update accordingly.",
    inputSchema: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Available focused-work minutes (e.g. 30, 60, 90, 120)." },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      required: ["minutes"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      store.getState().setAvailableMinutes(args.minutes);
      const st = store.getState();
      const totalActiveMinutes = st.tasks.filter(t => t.status === "backlog").reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
      return { content: [{ type: "text", text: JSON.stringify({
        status: "updated",
        availableMinutes: st.availableMinutes,
        overloadLevel: st.overloadLevel,
        totalActiveMinutes,
        capacity: st.currentProposal?.capacity || null,
        stateVersion: st.stateVersion,
      })}] };
    },
  });

  ctx.registerTool({
    name: "assess_overload",
    description: "Assesses the current workload status including task count, deadline count, and available time.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();
      const assessment = s.assessOverload();
      return { content: [{ type: "text", text: JSON.stringify({
        ...assessment,
        bottleneckTaskId: s.bottleneckTaskId,
      })}] };
    },
  });

  ctx.registerTool({
    name: "identify_bottleneck",
    description: "Identifies the bottleneck task with the most downstream dependents and closest deadline, returning the full task object and downstream chain.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();
      const bottleneckTaskId = s.identifyBottleneck();
      const task = s.tasks.find(t => t.id === bottleneckTaskId);

      // Build downstream chain transitively
      function getDownstreamChain(taskId) {
        const chain = new Set();
        function traverse(id) {
          s.tasks.filter(t => t.dependencies.includes(id)).forEach(t => {
            if (!chain.has(t.id)) {
              chain.add(t.id);
              traverse(t.id);
            }
          });
        }
        traverse(taskId);
        return Array.from(chain);
      }

      const downstreamChain = getDownstreamChain(bottleneckTaskId);
      const updatedState = store.getState();
      return { content: [{ type: "text", text: JSON.stringify({
        bottleneckTaskId,
        task,
        downstreamChain,
        stateVersion: updatedState.stateVersion,
      })}] };
    },
  });

  ctx.registerTool({
    name: "propose_focus_block",
    description: "Proposes a focus block plan starting from a specific task, including downstream dependencies in topological order.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The task to start the focus block with." },
        durationMinutes: { type: "number", description: "Duration of the focus block in minutes." },
        reason: { type: "string", description: "Optional reason for this proposal." },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      required: ["taskId", "durationMinutes"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Validate task exists
      const task = s.tasks.find(t => t.id === args.taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "TASK_NOT_FOUND",
          message: `Task with ID ${args.taskId} not found`,
          stateVersion: s.stateVersion,
        })}] };
      }

      // Build downstream chain via BFS topological sort
      function getDownstreamChain(startTaskId) {
        const visited = new Set();
        const queue = [startTaskId];
        const result = [];

        while (queue.length > 0) {
          const current = queue.shift();
          if (visited.has(current)) continue;
          visited.add(current);
          result.push(current);

          // Find tasks that depend on current
          s.tasks.filter(t => t.dependencies.includes(current)).forEach(t => {
            if (!visited.has(t.id)) queue.push(t.id);
          });
        }

        return result;
      }

      const orderedTaskIds = getDownstreamChain(args.taskId);

      const proposal = {
        id: "proposal-1",
        primaryTaskId: args.taskId,
        orderedTaskIds,
        rationale: [args.reason || "highest priority"],
        confidence: 0.85,
        requiresApproval: true,
      };

      s.proposePlan(proposal);
      const updatedProposal = store.getState().currentProposal;
      return { content: [{ type: "text", text: JSON.stringify({
        status: "proposed",
        proposal: updatedProposal,
        stateVersion: store.getState().stateVersion,
      })}] };
    },
  });

  // --- NEW TOOLS FOR SLICE 3 ---

  ctx.registerTool({
    name: "override_plan",
    description: "Override the primary task in the current proposal to a different active task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task to set as primary" },
        reason: { type: "string", description: "Why this override" },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Check if there's an active proposal
      if (!s.currentProposal) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "NO_ACTIVE_PROPOSAL",
          message: "No active proposal to override",
          stateVersion: s.stateVersion,
        })}] };
      }

      // Validate taskId exists
      const task = s.tasks.find(t => t.id === args.taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "TASK_NOT_FOUND",
          message: `Task with ID ${args.taskId} not found`,
          stateVersion: s.stateVersion,
        })}] };
      }

      // Record previous primary task
      const previousPrimaryTask = s.currentProposal.primaryTaskId;

      // Apply override
      store.getState().overridePrimary(args.taskId);

      // Get updated state
      const updatedState = store.getState();
      const updatedProposal = updatedState.currentProposal;

      return { content: [{ type: "text", text: JSON.stringify({
        status: "override_applied",
        previousPrimaryTask,
        newPrimaryTask: args.taskId,
        orderedTaskIds: updatedProposal.orderedTaskIds,
        stateVersion: updatedState.stateVersion,
      })}] };
    },
  });

  ctx.registerTool({
    name: "restructure_plan",
    description: "Restructure the plan's execution order based on task dependencies using topological sort.",
    inputSchema: {
      type: "object",
      properties: {
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Check if there's an active proposal
      if (!s.currentProposal) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "NO_ACTIVE_PROPOSAL",
          message: "No active proposal to restructure",
          stateVersion: s.stateVersion,
        })}] };
      }

      // Store old order
      const oldOrder = [...store.getState().currentProposal.orderedTaskIds];

      // BFS topological sort starting from primaryTaskId
      function getDownstreamChain(startTaskId) {
        const visited = new Set();
        const queue = [startTaskId];
        const result = [];

        while (queue.length > 0) {
          const current = queue.shift();
          if (visited.has(current)) continue;
          visited.add(current);
          result.push(current);

          // Find tasks that depend on current
          s.tasks.filter(t => t.dependencies.includes(current)).forEach(t => {
            if (!visited.has(t.id)) queue.push(t.id);
          });
        }

        return result;
      }

      const newOrder = getDownstreamChain(s.currentProposal.primaryTaskId);

      // Filter to only include task IDs that are in the current orderedTaskIds
      let filteredOrder = newOrder.filter(tid => oldOrder.includes(tid));
      // Fall back to primaryTaskId if filtered result is empty
      if (filteredOrder.length === 0) {
        filteredOrder = [s.currentProposal.primaryTaskId];
      }

      store.getState().setProposalOrder(filteredOrder);
      const updatedVersion = store.getState().stateVersion;

      return { content: [{ type: "text", text: JSON.stringify({
        status: "restructured",
        previousOrder: oldOrder,
        newOrder: filteredOrder,
        stateVersion: updatedVersion,
      })}] };
    },
  });

  ctx.registerTool({
    name: "defer_task",
    description: "Defer a task to move it out of the current backlog.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task to defer" },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Validate taskId exists
      const task = s.tasks.find(t => t.id === args.taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "TASK_NOT_FOUND",
          message: `Task with ID ${args.taskId} not found`,
          stateVersion: s.stateVersion,
        })}] };
      }

      // Apply defer
      store.getState().deferTask(args.taskId);

      const updatedVersion = store.getState().stateVersion;

      return { content: [{ type: "text", text: JSON.stringify({
        status: "deferred",
        taskId: args.taskId,
        stateVersion: updatedVersion,
      })}] };
    },
  });

  // --- NEW TOOLS FOR SLICE 4 ---

  ctx.registerTool({
    name: "start_focus_block",
    description: "Starts a focus block if human approval has been granted via the UI.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to validate (optional)" },
        durationMinutes: { type: "number", description: "Optional duration override" },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Check if a focus block is active
      if (!s.activeFocusBlock || s.activeFocusBlock.status !== 'active') {
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "error",
            code: "HUMAN_APPROVAL_REQUIRED",
            message: "Human must approve via the Start Here button in the UI before a focus block can start",
            stateVersion: s.stateVersion,
          })}]
        };
      }

      // Validate taskId if provided
      if (args?.taskId && args.taskId !== s.activeFocusBlock.taskId) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "error",
            code: "TASK_MISMATCH",
            message: `Task ID does not match active focus block (${s.activeFocusBlock.taskId})`,
            stateVersion: s.stateVersion,
          })}]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          status: "active",
          taskId: s.activeFocusBlock.taskId,
          durationMinutes: s.activeFocusBlock.durationMinutes,
          startedAt: s.activeFocusBlock.startedAt,
          stateVersion: s.stateVersion,
        })}]
      };
    },
  });

  ctx.registerTool({
    name: "complete_focus_block",
    description: "Completes or abandons the current active focus block.",
    inputSchema: {
      type: "object",
      properties: {
        result: {
          type: "string",
          enum: ["completed", "partially_completed", "abandoned"],
          description: "How the block ended"
        },
        expectedStateVersion: { type: "number", description: "Expected current state version for stale-state detection" },
      },
      required: ["result"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const { default: store } = await import('../store/focusStore.js');
      const s = store.getState();

      // Stale-state check
      if (args?.expectedStateVersion !== undefined && s.stateVersion !== args.expectedStateVersion) {
        return { content: [{ type: "text", text: JSON.stringify({
          status: "error",
          code: "STALE_STATE",
          message: "The workload has changed since your last read. Please re-assess before proposing changes.",
          currentStateVersion: s.stateVersion,
          expectedStateVersion: args.expectedStateVersion,
        })}] };
      }

      // Check if there's an active block
      if (!s.activeFocusBlock) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "error",
            code: "NO_ACTIVE_BLOCK",
            message: "No active focus block to complete",
            stateVersion: s.stateVersion,
          })}]
        };
      }

      // Complete the block and advance to the next task. The store computes and
      // returns structured next-task info so the agent can continue reasoning.
      const outcome = store.getState().completeFocusBlock(args.result);

      return {
        content: [{ type: "text", text: JSON.stringify(outcome) }]
      };
    },
  });

  ctx.getTools().then(tools => console.log("FOCUS WebMCP tools registered:", tools.map(t => t.name)));
}
