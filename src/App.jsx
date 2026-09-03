import { useState } from 'react';
import CognitiveMap from './components/CognitiveMap/CognitiveMap.jsx';
import FocusCenter from './components/FocusCenter/FocusCenter.jsx';
import PlanTimeline from './components/PlanTimeline/PlanTimeline.jsx';
import FocusMode from './components/FocusMode/FocusMode.jsx';
import ActivityRail from './components/ActivityRail/ActivityRail.jsx';
import useFocusStore from './store/focusStore.js';

// Lightweight time presets — the single lever that re-plans scope.
const TIME_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '60m', minutes: 60 },
  { label: '90m', minutes: 90 },
  { label: '2h', minutes: 120 },
];

function App() {
  const overloadLevel = useFocusStore(s => s.overloadLevel);
  const availableMinutes = useFocusStore(s => s.availableMinutes);
  const bottleneckTaskId = useFocusStore(s => s.bottleneckTaskId);
  const currentProposal = useFocusStore(s => s.currentProposal);
  const activeFocusBlock = useFocusStore(s => s.activeFocusBlock);
  const tasks = useFocusStore(s => s.tasks);
  const setAvailableMinutes = useFocusStore(s => s.setAvailableMinutes);

  // The one task the UI steers toward: the proposal's primary if a plan exists,
  // otherwise the agent-identified bottleneck.
  const displayTaskId = currentProposal ? currentProposal.primaryTaskId : bottleneckTaskId;
  const displayTask = displayTaskId ? tasks.find(t => t.id === displayTaskId) : null;

  const activeCount = tasks.filter(t => t.status === 'backlog').length;
  const isFocusing = activeFocusBlock?.status === 'active';
  const allDone = activeCount === 0 && !isFocusing;

  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('');

  const handlePreset = (minutes) => { setCustomOpen(false); setCustomMinutes(''); setAvailableMinutes(minutes); };
  const handleCustom = () => {
    const m = parseInt(customMinutes, 10);
    if (m > 0) setAvailableMinutes(m);
    setCustomOpen(false);
  };

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <h1 className="logo">FOCUS</h1>
          <span className="reticle-dot" aria-hidden="true"></span>
          <span className="top-bar-separator"></span>
          <span className="today-label">TODAY</span>
          <span className="avail-sep" aria-hidden="true">·</span>
          <span className="available-time">
            <span className="avail-num"><span className="avail-value">{availableMinutes}</span>m</span> available
          </span>
          <div className="time-select">
            {TIME_PRESETS.map(p => (
              <button
                key={p.minutes}
                className={`time-preset ${!customOpen && availableMinutes === p.minutes ? 'is-active' : ''}`}
                onClick={() => handlePreset(p.minutes)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={`time-preset ${customOpen ? 'is-active' : ''}`}
              onClick={() => setCustomOpen(!customOpen)}
            >
              custom
            </button>
            {customOpen && (
              <span className="time-select-custom">
                <input
                  type="number"
                  min="15"
                  step="15"
                  placeholder="min"
                  autoFocus
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustom()}
                />
                <button className="btn btn-text time-select-set" onClick={handleCustom}>Set</button>
              </span>
            )}
          </div>
        </div>
        <div className="top-bar-right">
          <span className={`overload-signal ${overloadLevel === 'high' ? 'is-high' : ''}`}>
            <span className="overload-lamp" aria-hidden="true"></span>
            OVERLOAD {overloadLevel.toUpperCase()}
          </span>
          <button
            className="btn btn-text top-bar-companion"
            onClick={() => window.open('/companion.html', 'webmcp-companion', 'width=980,height=760')}
          >
            Companion
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="map-canvas">
          <CognitiveMap />
        </div>

        {/* Focus Center — the dominant centred card carrying the next action.
            It overlays the (receded) graph, which stays full-bleed behind it. */}
        <div className="focus-center-layer">
          {allDone ? (
            <div className="all-clear">
              <span className="reticle-dot" aria-hidden="true"></span>
              <h2 className="all-clear-title">All clear</h2>
              <p className="all-clear-sub">Every task is done. Step away.</p>
            </div>
          ) : displayTask && !isFocusing ? (
            <FocusCenter task={displayTask} />
          ) : null}
        </div>

        <PlanTimeline />
        <ActivityRail />
      </main>

      <FocusMode />
    </div>
  );
}

export default App;
