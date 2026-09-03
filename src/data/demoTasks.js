export const TASKS = [
  // School
  { id: "management-ch7", title: "Finish Management Chapter 7", priority: "high", status: "backlog", estimatedMinutes: 25, dueAt: "2026-09-03T23:59:00", dependencies: [], tags: ["school"] },
  { id: "quiz-prep", title: "Study for Quiz", priority: "critical", status: "backlog", estimatedMinutes: 45, dueAt: "2026-09-03T08:00:00", dependencies: ["management-ch7"], tags: ["school"] },
  { id: "complete-quiz", title: "Complete Quiz", priority: "critical", status: "backlog", estimatedMinutes: 30, dueAt: "2026-09-03T10:00:00", dependencies: ["quiz-prep"], tags: ["school"] },
  { id: "project-intro", title: "Write Project Introduction", priority: "high", status: "backlog", estimatedMinutes: 40, dueAt: "2026-09-07T23:59:00", dependencies: [], tags: ["school"] },
  { id: "math-assignment", title: "Complete Math Assignment", priority: "medium", status: "backlog", estimatedMinutes: 35, dueAt: "2026-09-04T23:59:00", dependencies: ["complete-quiz"], tags: ["school"] },
  { id: "read-article", title: "Read Research Article", priority: "medium", status: "backlog", estimatedMinutes: 20, dueAt: null, dependencies: [], tags: ["school"] },
  { id: "presentation-prep", title: "Prepare Presentation", priority: "high", status: "backlog", estimatedMinutes: 50, dueAt: "2026-09-07T23:59:00", dependencies: ["project-intro"], tags: ["school"] },
  { id: "email-teacher", title: "Email Teacher About Extension", priority: "medium", status: "backlog", estimatedMinutes: 10, dueAt: "2026-09-03T08:00:00", dependencies: [], tags: ["school"] },
  // Life
  { id: "clean-room", title: "Clean Room", priority: "low", status: "backlog", estimatedMinutes: 30, dueAt: null, dependencies: [], tags: ["life"] },
  { id: "laundry", title: "Do Laundry", priority: "low", status: "backlog", estimatedMinutes: 45, dueAt: null, dependencies: ["clean-room"], tags: ["life"] },
  { id: "workout", title: "Workout", priority: "medium", status: "backlog", estimatedMinutes: 20, dueAt: null, dependencies: [], tags: ["life"] },
  { id: "shower", title: "Shower", priority: "medium", status: "backlog", estimatedMinutes: 15, dueAt: null, dependencies: ["workout"], tags: ["life"] },
  { id: "pack-backpack", title: "Pack Backpack", priority: "medium", status: "backlog", estimatedMinutes: 10, dueAt: "2026-09-03T08:00:00", dependencies: ["management-ch7", "clean-room"], tags: ["life"] },
];

export const DEMO_CONTEXT = {
  availableMinutes: 120,
  overloadLevel: "high",
};
