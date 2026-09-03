import { useState, useEffect, useRef } from 'react';
import useFocusStore from '../../store/focusStore.js';

const RING_R = 56;
const CIRC = 2 * Math.PI * RING_R;

export default function FocusMode() {
  const activeFocusBlock = useFocusStore(s => s.activeFocusBlock);
  const tasks = useFocusStore(s => s.tasks);
  const completeFocusBlock = useFocusStore(s => s.completeFocusBlock);

  const [timeRemaining, setTimeRemaining] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!activeFocusBlock || activeFocusBlock.status !== 'active') {
      setTimeRemaining(null);
      setElapsed(0);
      return;
    }

    const durationMs = (activeFocusBlock.durationMinutes || 25) * 60 * 1000;
    const startedAt = new Date(activeFocusBlock.startedAt).getTime();

    const tick = () => {
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const remaining = Math.max(0, durationMs - elapsedMs);
      setTimeRemaining(remaining);
      setElapsed(elapsedMs);
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [activeFocusBlock]);

  if (!activeFocusBlock || activeFocusBlock.status !== 'active') return null;

  const task = tasks.find(t => t.id === activeFocusBlock.taskId);
  const durationMs = (activeFocusBlock.durationMinutes || 25) * 60 * 1000;
  const progress = Math.min(100, (elapsed / durationMs) * 100);

  const minutes = Math.floor((timeRemaining ?? 0) / 60000);
  const seconds = Math.floor(((timeRemaining ?? 0) % 60000) / 1000);

  const handlePause = () => setPaused(!paused);

  const handleComplete = (result) => {
    clearInterval(intervalRef.current);
    completeFocusBlock(result);
  };

  // The aperture ring draws in as time elapses (one hairline circle).
  const dashOffset = CIRC * (1 - progress / 100);

  return (
    <div className="focus-mode-overlay">
      <div className="focus-mode-aperture">
        <svg className="focus-mode-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgba(243,236,223,0.18)" strokeWidth="1" />
          <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--accent)" strokeWidth="1"
            strokeDasharray={CIRC} strokeDashoffset={dashOffset}
            transform="rotate(-90 60 60)" strokeLinecap="butt" />
        </svg>
        <div className="focus-mode-content">
          <div className="focus-mode-label">FOCUS BLOCK</div>
          <h1 className="focus-mode-title">{task?.title || 'Focused Work'}</h1>

          <div className="focus-mode-timer">
            <span className="focus-mode-time">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
            <span className="focus-mode-total-label">
              of {activeFocusBlock.durationMinutes} min
            </span>
          </div>

          <div className="focus-mode-subtext">
            One task. Nothing else.
          </div>

          <div className="focus-mode-actions">
            {!paused ? (
              <button className="btn btn-secondary" onClick={handlePause}>PAUSE</button>
            ) : (
              <button className="btn btn-secondary" onClick={handlePause}>RESUME</button>
            )}
            <button className="btn btn-primary" onClick={() => handleComplete('completed')}>COMPLETE</button>
            <button className="btn btn-text btn-clay" onClick={() => handleComplete('abandoned')}>ABANDON</button>
          </div>
        </div>
      </div>
    </div>
  );
}
