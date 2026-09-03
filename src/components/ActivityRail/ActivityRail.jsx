import { useState, useEffect, useRef } from 'react';
import useFocusStore from '../../store/focusStore.js';

const MAX_EVENTS = 8;

// Trim a task title to ~24 chars + ellipsis (clean word boundary) for the feed.
function trimTitle(t, max = 24) {
  let s = (t || '').trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const space = s.lastIndexOf(' ');
  if (space > max * 0.6) s = s.slice(0, space);
  return s.trimEnd() + '…';
}

export default function ActivityRail({ style }) {
  const stateVersion = useFocusStore(s => s.stateVersion);
  const overloadLevel = useFocusStore(s => s.overloadLevel);
  const currentProposal = useFocusStore(s => s.currentProposal);
  const activeFocusBlock = useFocusStore(s => s.activeFocusBlock);
  const bottleneckTaskId = useFocusStore(s => s.bottleneckTaskId);
  const tasks = useFocusStore(s => s.tasks);

  const [events, setEvents] = useState([]);

  // Snapshot of the previous relevant state. On mount we seed it silently so the
  // log only ever describes real changes, never fake "activity".
  const prev = useRef(null);

  useEffect(() => {
    const title = (id) => tasks.find(t => t.id === id)?.title || id;

    const cur = {
      overload: overloadLevel,
      bottleneck: bottleneckTaskId,
      proposalExists: !!currentProposal,
      proposalPrimary: currentProposal?.primaryTaskId || null,
      proposalMinutes: (tasks.find(t => t.id === currentProposal?.primaryTaskId)?.estimatedMinutes) || 0,
      focusStatus: activeFocusBlock?.status || null,
      focusTaskId: activeFocusBlock?.taskId || null,
    };

    if (!prev.current) {
      prev.current = cur;
      return;
    }

    const before = prev.current;
    prev.current = cur;

    const msgs = [];
    const pfs = before.focusStatus, cfs = cur.focusStatus;

    // Focus-block status transitions
    if (cfs === 'active' && pfs !== 'active') {
      msgs.push({ text: `Focus block started: ${trimTitle(title(cur.focusTaskId))}` });
    } else if (pfs === 'active' && (cfs === 'completed' || cfs === 'partially_completed')) {
      msgs.push({ text: `Block completed: ${trimTitle(title(cur.focusTaskId))}` });
    } else if (pfs === 'active' && cfs === 'abandoned') {
      msgs.push({ text: `Block abandoned: ${trimTitle(title(cur.focusTaskId))}` });
    }

    // Proposal created / primary overridden
    if (!before.proposalExists && cur.proposalExists) {
      msgs.push({ text: `Focus block proposed: ${trimTitle(title(cur.proposalPrimary))} (${cur.proposalMinutes}m)` });
    } else if (before.proposalExists && cur.proposalExists && before.proposalPrimary !== cur.proposalPrimary) {
      msgs.push({ text: `Override → primary: ${trimTitle(title(cur.proposalPrimary))}` });
    }

    // Bottleneck identified / changed
    if (before.bottleneck !== cur.bottleneck && cur.bottleneck) {
      msgs.push({ text: `Bottleneck identified: ${trimTitle(title(cur.bottleneck))}` });
    }

    // Overload level changed (rendered red, consistent with the top-bar badge)
    if (before.overload !== cur.overload) {
      msgs.push({ text: `Overload assessed: ${cur.overload}`, danger: true });
    }

    if (msgs.length === 0) return;

    setEvents(prevEvents => {
      let next = [...prevEvents];
      for (const m of msgs) {
        // Dedupe a duplicate that would land on the existing top entry
        // (also erases the double-render duplicate in dev).
        if (next[0]?.text === m.text) continue;
        next.unshift({ text: m.text, danger: !!m.danger, version: stateVersion });
      }
      return next.slice(0, MAX_EVENTS);
    });
  }, [stateVersion]);

  if (events.length === 0) return null;

  return (
    <div className="activity-rail" style={style}>
      <div className="activity-rail-label">AGENT LOG</div>
      <div className="activity-list">
        {events.map((e, i) => (
          <div key={i} className={`activity-item ${e.danger ? 'is-overload' : ''}`}>
            <span className="activity-version">v{e.version}</span>
            <span className="activity-detail">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
