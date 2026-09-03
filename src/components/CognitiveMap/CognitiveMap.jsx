import { useMemo, useEffect } from 'react';
import useFocusStore from '../../store/focusStore.js';

// Layout constants - responsive SVG. The viewBox height is generous enough
// that the whole composition (spine + constellation + legend) occupies the
// vertical space; CSS scales the SVG to fill its container.
const SVG_W = 800;
const SVG_H = 600;
const PAD = 40;
const GRAPH_W = SVG_W - PAD * 2;

// Node radius by kind.
const R = { focus: 40, plan: 28, context: 16 };

// Priority nudges a plane node a couple px.
const PRIORITY_NUDGE = { critical: 2, high: 1, medium: 0, low: -2 };

// Font sizes by kind.
const FONT = { focus: 13, plan: 12, context: 10 };

// Vertical spacing (viewBox units).
const SPINE_Y = 224;            // vertical center of the primary spine row
const LABEL_BASE_OFFSET = 14;   // node bottom -> first title baseline
const TITLE_LINE_DY = 13;       // title line 1 -> line 2 baseline
const DURATION_OFFSET = 40;     // node bottom -> duration baseline
const CONST_LABEL_OFFSET = 11;  // constellation node bottom -> label baseline
const CONST_LINE_DY = 12;
const CONST_ROW_Y = 390;        // first constellation row center
const CONST_ROW_GAP = 62;       // vertical gap between constellation rows

// Clay = deadline/overload only. Never lit.
const FLAG_COLOR = 'var(--clay)';

const MONO = 'var(--font-mono)';

// Full title, wrapped to a second line on a word boundary.
function wrapTitle(title, maxChars) {
  const clean = (title || '').trim();
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(/\s+/);
  let line1 = '';
  for (const w of words) {
    const candidate = line1 ? `${line1} ${w}` : w;
    if (candidate.length <= maxChars) line1 = candidate;
    else break;
  }
  const rest = clean.slice(line1.length).trim();
  if (!rest) return [line1];
  return [line1, rest];
}

export default function CognitiveMap({ onFocusAnchor }) {
  const tasks = useFocusStore(s => s.tasks);
  const bottleneckTaskId = useFocusStore(s => s.bottleneckTaskId);
  const currentProposal = useFocusStore(s => s.currentProposal);

  // The node the UI steers toward: the proposal's primary if a plan exists,
  // otherwise the agent-identified bottleneck.
  const focusedTaskId = currentProposal?.primaryTaskId || bottleneckTaskId;

  const layout = useMemo(() => {
    const active = tasks.filter(t => t.status !== "completed" && t.status !== "deferred");
    const activeIds = new Set(active.map(t => t.id));
    const byId = new Map(active.map(t => [t.id, t]));

    const hasProposal = !!currentProposal &&
      Array.isArray(currentProposal.orderedTaskIds) &&
      currentProposal.orderedTaskIds.length > 0;

    const positions = {};
    let spineIds = [];
    let result;

    if (hasProposal) {
      // ---- State B (hero): primary spine + receded constellation ----
      spineIds = currentProposal.orderedTaskIds.filter(id => activeIds.has(id));

      const n = Math.max(1, spineIds.length);
      const spacing = GRAPH_W / n;
      spineIds.forEach((id, i) => {
        const task = byId.get(id);
        const isFocus = id === focusedTaskId;
        const nudge = PRIORITY_NUDGE[task?.priority] || 0;
        const size = isFocus ? R.focus : Math.max(R.plan + nudge, 26);
        positions[id] = { x: PAD + spacing * (i + 0.5), y: SPINE_Y, size, kind: isFocus ? 'focus' : 'plan' };
      });

      // Remaining active tasks: a receded constellation below the spine.
      const constIds = active.filter(t => !positions[t.id]).map(t => t.id);
      const nConst = constIds.length;
      const rows = nConst > 6 ? 2 : 1;
      const rowCount = rows === 2 ? Math.ceil(nConst / 2) : nConst;
      let constMaxLabelBottom = 0;

      constIds.forEach((id, i) => {
        const row = rows === 2 ? (i < rowCount ? 0 : 1) : 0;
        const rowIndex = rows === 2 ? (row === 0 ? i : i - rowCount) : i;
        const rowSize = rows === 2 ? (row === 0 ? rowCount : nConst - rowCount) : nConst;
        const y = CONST_ROW_Y + row * CONST_ROW_GAP;
        const x = PAD + (GRAPH_W / rowSize) * (rowIndex + 0.5);
        positions[id] = { x, y, size: R.context, kind: 'context' };

        const lines = wrapTitle(byId.get(id)?.title || '', 14);
        const labelBottom = y + R.context + CONST_LABEL_OFFSET + (lines.length - 1) * CONST_LINE_DY;
        constMaxLabelBottom = Math.max(constMaxLabelBottom, labelBottom);
      });

      const constMinutes = constIds.reduce(
        (sum, id) => sum + (byId.get(id)?.estimatedMinutes || 0), 0);

      const captionY = Math.max(constMaxLabelBottom, SPINE_Y + R.plan + DURATION_OFFSET) + 26;
      // Keep the KEY legend (and its rows) inside the frame, above the fold.
      const LEGEND_TOP = Math.min(captionY + 14, SVG_H - 84);
      result = { positions, spineIds, hasProposal, constMinutes, captionY, LEGEND_TOP, constMaxLabelBottom };
    } else {
      // ---- State A (overwhelmed overview): the full map gathered into a centred
      // concentric-ring constellation around the focal point. Nodes sit ON the
      // graticule rings (receded) so the room reads as "full of things gathered
      // toward the centre" — not a corner cluster with a dead band. The chosen
      // anchor (bottleneck, if identified) sits dead-centre as the one lit point.
      const RING_R = [72, 118, 164];     // concentric radii (viewBox units)
      const RING_CAP = [4, 5];           // inner + middle ring capacity; outer takes the rest
      const CENTER_Y = 280;              // constellation centre leaves room for the footer
      const ringOf = (i) => (i < RING_CAP[0] ? 0 : i < RING_CAP[0] + RING_CAP[1] ? 1 : 2);
      const ringCount = (r) =>
        r < 2 ? RING_CAP[r] : active.length - RING_CAP[0] - RING_CAP[1];
      const indexInRing = (i) => {
        const r = ringOf(i);
        if (r === 0) return i;
        if (r === 1) return i - RING_CAP[0];
        return i - RING_CAP[0] - RING_CAP[1];
      };

      if (focusedTaskId) {
        positions[focusedTaskId] = { x: SVG_W / 2, y: CENTER_Y, size: 34, kind: 'focus', isOverview: true };
      }
      // Long titles go to the spacious outer ring so their wrapped labels don't
      // collide with neighbouring nodes in the tight inner rings.
      active.filter(t => t.id !== focusedTaskId)
        .sort((a, b) => (a.title?.length || 0) - (b.title?.length || 0))
        .forEach((t, i) => {
          const r = ringOf(i);
          const count = ringCount(r) || 1;
          const angle = -Math.PI / 2 + (indexInRing(i) / count) * Math.PI * 2;
          const rad = RING_R[r];
          positions[t.id] = {
            x: SVG_W / 2 + rad * Math.cos(angle),
            y: CENTER_Y + rad * Math.sin(angle),
            size: R.context,
            kind: 'context',
            isOverview: true,
          };
        });

      const activeMinutes = active.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
      // Anchor the footer directly beneath the lowest node label, above the fold.
      const lowestRingBottom = CENTER_Y + RING_R[2] + R.context + CONST_LABEL_OFFSET + CONST_LINE_DY;
      const captionY = Math.min(lowestRingBottom + 18, SVG_H - 96);
      const LEGEND_TOP = Math.min(captionY + 18, SVG_H - 84);
      result = { positions, spineIds, hasProposal, captionY, LEGEND_TOP, activeCount: active.length, activeMinutes };
    }

    return result;
  }, [tasks, currentProposal, bottleneckTaskId, focusedTaskId]);

  // Report the focused node's viewBox anchor (for the plaque) plus the legend's
  // top edge (so the parent can stack the AGENT LOG above the KEY legend).
  useEffect(() => {
    const p = focusedTaskId ? layout.positions[focusedTaskId] : null;
    onFocusAnchor?.({
      anchor: p ? { x: p.x, y: p.y, size: p.size, hasProposal: layout.hasProposal } : null,
      legendTop: layout.LEGEND_TOP,
    });
  }, [focusedTaskId, layout, onFocusAnchor]);

  // Dependency edges across ALL active tasks (prereq -> dependent).
  const edges = useMemo(() => {
    const res = [];
    const pos = layout.positions;
    tasks.forEach(t => {
      if (t.status === "completed" || t.status === "deferred") return;
      (t.dependencies || []).forEach(depId => {
        if (pos[depId] && pos[t.id]) res.push({ from: depId, to: t.id });
      });
    });
    return res;
  }, [tasks, layout.positions]);

  const hasSpine = layout.spineIds.length > 0;
  const caption = layout.hasProposal
    ? `${layout.positions ? Object.values(layout.positions).filter(p => p.kind === 'context').length : 0} more in context · ${layout.constMinutes}m`
    : `${layout.activeCount} active · ${layout.activeMinutes}m`;

  // Which legend states are actually present right now (truthful key).
  const present = { focus: false, plan: false, context: false, deadline: false };
  Object.values(layout.positions).forEach(p => {
    present[p.kind] = true;
  });
  present.deadline = Object.keys(layout.positions).some(id => {
    const t = tasks.find(x => x.id === id);
    return !!t?.dueAt;
  });

  // Focal point for the graticule / radial drift (the focused node, else center).
  const focus = focusedTaskId ? layout.positions[focusedTaskId] : null;
  const focal = focus || { x: SVG_W / 2, y: SVG_H / 2 };

  // Radial drift: in State A the constellation nodes dim by distance from the
  // focal point, so the dark reads as "full of things, gathered toward the
  // centre" rather than blank. Clamped to [0.18, 0.30].
  const driftOpacity = (p) => {
    if (layout.hasProposal) return 1;
    const dist = Math.hypot(p.x - focal.x, p.y - focal.y);
    const v = 0.30 - (dist / 460) * 0.12;
    return Math.min(0.30, Math.max(0.18, v));
  };

  // Receded opacity by node kind in State B (post-lock): every surface that is
  // not the one lit node drops toward Ash.
  const nodeOpacity = (p) => {
    if (!layout.hasProposal) return driftOpacity(p);
    if (p.kind === 'focus') return 1;
    if (p.kind === 'plan') return 0.55;
    return 0.18;
  };
  const nodeLabelOpacity = (p) => {
    if (!layout.hasProposal) return 0.45;
    if (p.kind === 'focus') return 1;
    if (p.kind === 'plan') return 0.72;
    return 0.42;
  };

  // Build path for an edge between two positioned nodes, bowing gently away
  // from the chord and ending with a filled arrowhead at the dependent node.
  const edgePath = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const sx = from.x + ux * (from.size + 2);
    const sy = from.y + uy * (from.size + 2);
    const ex = to.x - ux * (to.size + 3);
    const ey = to.y - uy * (to.size + 3);
    const bend = Math.min(18, Math.max(5, dist * 0.05));
    let px = -uy, py = ux;
    if (py > 0) { px = -px; py = -py; }  // bow toward the empty band
    const mx = (sx + ex) / 2 + px * bend;
    const my = (sy + ey) / 2 + py * bend;
    return { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, hero: false, noArrow: dist < (from.size + to.size) };
  };

  const isHeroEdge = (edge) =>
    hasSpine &&
    layout.spineIds.includes(edge.from) &&
    layout.spineIds.includes(edge.to);

  // The Lock geometry: a hairline reticle around the one lit node.
  const reticle = focus && layout.hasProposal
    ? (() => {
        const ringR = focus.size + 12;
        const ridge = (focus.size + 18) * 0.707;
        const s = focus.size + 24; // start radius (cardinal points)
        return {
          ringR,
          ticks: [
            { key: 'ne', cx: ridge, cy: -ridge, fx: 0,   fy: -s, path: 'M -8 0 L 0 0 L 0 8' },
            { key: 'se', cx: ridge, cy: ridge,  fx: s,   fy: 0,  path: 'M -8 0 L 0 0 L 0 -8' },
            { key: 'sw', cx: -ridge, cy: ridge, fx: 0,   fy: s,  path: 'M 8 0 L 0 0 L 0 -8' },
            { key: 'nw', cx: -ridge, cy: -ridge, fx: -s, fy: 0,  path: 'M 8 0 L 0 0 L 0 8' },
          ],
        };
      })()
    : null;

  // A shaft of light falling from a defined aperture at the top of the room
  // onto the lit node. It emerges NARROW at the gate and opens wider as it
  // descends (a real cone, gateHalf ≪ bottomHalf), so it reads as a lamp
  // illuminating the node — not a parallel smear. Intensity is highest at the
  // aperture and diffuses downward via beam-fall.
  const beam = focus && layout.hasProposal
    ? (() => {
        const gateY = 4;                       // the top-of-frame aperture edge
        const gateHalf = 24;                   // narrow at the source
        const bottomHalf = focus.size * 1.25;  // opens to ~the node width
        const bottomY = focus.y - focus.size + 2;
        return {
          d: `M ${focus.x - gateHalf} ${gateY} L ${focus.x + gateHalf} ${gateY} L ${focus.x + bottomHalf} ${bottomY} L ${focus.x - bottomHalf} ${bottomY} Z`,
          gateY,
          gateHalf,
          bottomHalf,
          bottomY,
          coreR: focus.size + 16,
        };
      })()
    : null;

  return (
    <div className="cognitive-map-container">
      <svg width="100%" height="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="cognitive-map-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrow-neutral" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--ash)" />
          </marker>
          <marker id="arrow-accent" viewBox="0 0 10 10" refX="10" refY="5"
            markerWidth="10" markerHeight="10" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--warm-gold)" />
          </marker>
          {/* The Lamp shaft: a cone of light falling from the top-of-frame gate
              onto the lit node. Falloff is SVG gradient opacity (no CSS blur),
              so the cone reads as light receding as it travels DOWN from the
              aperture — brightest at the source, diffusing into the room. The
              colour is warm-WHITE (not gold): gold at low opacity over charcoal
              mixes to brown; warm-white reads as a luminous shaft. */}
          <linearGradient id="beam-fall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF7E9" stopOpacity="0.34" />
            <stop offset="42%" stopColor="#FBE7B8" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#EFD792" stopOpacity="0.04" />
          </linearGradient>
          <radialGradient id="beam-core" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#FFFBEF" stopOpacity="0.62" />
            <stop offset="42%" stopColor="#FBEAC1" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#D9A94A" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Concentric-room graticule — implied radial drift toward the focal point.
            Drawn only in the overwhelmed overview (State A); once a plan locks in,
            the spine + receded constellation already carry the structure and the
            rings would read as node-graph noise. */}
        {!layout.hasProposal && (
          <g className="graticule" opacity="var(--graticule-opacity)">
            {[110, 190, 280, 380].map(r => (
              <circle key={r} cx={focal.x} cy={focal.y} r={r} fill="none"
                stroke="var(--ash)" strokeWidth="1" />
            ))}
            <line x1={focal.x - 420} y1={focal.y} x2={focal.x + 420} y2={focal.y} stroke="var(--ash)" strokeWidth="1" />
            <line x1={focal.x} y1={focal.y - 300} x2={focal.x} y2={focal.y + 300} stroke="var(--ash)" strokeWidth="1" />
          </g>
        )}

        {/* Beam shaft (State B, onto the lit node) — a defined cone of light */}
        {beam && (
          <g className="beam">
            <path d={beam.d} fill="url(#beam-fall)" />
            {/* Faint cone silhouette edges so the shaft reads as defined, not smeared */}
            <line x1={focus.x - beam.gateHalf} y1={beam.gateY} x2={focus.x - beam.bottomHalf} y2={beam.bottomY}
              stroke="#FFF7E9" strokeWidth="0.6" opacity="0.20" />
            <line x1={focus.x + beam.gateHalf} y1={beam.gateY} x2={focus.x + beam.bottomHalf} y2={beam.bottomY}
              stroke="#FFF7E9" strokeWidth="0.6" opacity="0.20" />
            {/* The gate: a crisp top-of-frame edge where the aperture is */}
            <line x1={focus.x - beam.gateHalf} y1={beam.gateY} x2={focus.x + beam.gateHalf} y2={beam.gateY}
              stroke="var(--accent)" strokeWidth="1" opacity="0.6" />
            {/* Lamp glow just inside the aperture — the light's source */}
            <ellipse cx={focus.x} cy={beam.gateY + 3} rx={beam.gateHalf + 6} ry={4}
              fill="#FFF7E9" opacity="0.22" />
            {/* Near-white-warm pool so the node itself reads as lit */}
            <circle cx={focus.x} cy={focus.y} r={beam.coreR} fill="url(#beam-core)" />
          </g>
        )}

        {/* Dependency edges (behind nodes) */}
        <g className="dependency-lines">
          {edges.map(edge => {
            const from = layout.positions[edge.from];
            const to = layout.positions[edge.to];
            if (!from || !to) return null;
            const { d, noArrow } = edgePath(from, to);
            if (noArrow) return null;
            const hero = isHeroEdge(edge);
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={d}
                fill="none"
                stroke={hero ? 'var(--ash)' : 'var(--ash)'}
                strokeOpacity={hero ? 0.62 : (hasSpine ? 0.22 : 0.3)}
                strokeWidth={hero ? 1.3 : 1}
                markerEnd={hero ? 'url(#arrow-neutral)' : 'url(#arrow-neutral)'}
              />
            );
          })}
        </g>

        {/* Receded constellation (State B) behind the spine */}
        {hasSpine && (
          <g className="context-constellation">
            {Object.entries(layout.positions).map(([id, p]) => {
              if (p.kind !== 'context') return null;
              const task = tasks.find(t => t.id === id);
              const lines = wrapTitle(task?.title || "", 14);
              const op = nodeOpacity(p);
              return (
                <g key={id} className="context-node" opacity={op}>
                  <circle cx={p.x} cy={p.y} r={p.size} fill="var(--ash)" />
                  <text x={p.x} y={p.y + p.size + CONST_LABEL_OFFSET} textAnchor="middle"
                    fontFamily={MONO} fontSize={FONT.context} fill="var(--ash)" opacity="0.7"
                    style={{ pointerEvents: 'none' }} title={task?.title || ''}>
                    {lines[0]}
                    {lines.length > 1 && <tspan x={p.x} dy={CONST_LINE_DY}>{lines[1]}</tspan>}
                  </text>
                  {task?.dueAt && (
                    <circle cx={p.x + p.size * 0.7} cy={p.y - p.size * 0.7} r={3.5}
                      fill={FLAG_COLOR} opacity="0.8" />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Spine + overview nodes */}
        {Object.entries(layout.positions).map(([id, p]) => {
          if (hasSpine && p.kind === 'context') return null; // already drawn in constellation
          const task = tasks.find(t => t.id === id);
          const isFocus = p.kind === 'focus';
          const maxChars = p.kind === 'context' ? 14 : 18;
          const lines = wrapTitle(task?.title || "", maxChars);
          const fontSize = FONT[p.kind] || 10;
          const op = nodeOpacity(p);
          const labelOp = nodeLabelOpacity(p);

          const fill = isFocus ? 'var(--ivory)' : (p.kind === 'context' ? 'var(--ash)' : 'var(--bg-secondary)');
          const stroke = isFocus ? 'none' : `var(--border)`;
          const strokeWidth = isFocus ? 0 : 1;
          const labelColor = p.kind === 'context' ? 'var(--ash)' : 'var(--ivory)';
          const labelWeight = isFocus ? 600 : 500;

          const labelOffset = p.kind === 'context' ? CONST_LABEL_OFFSET : LABEL_BASE_OFFSET;
          const lineDy = p.kind === 'context' ? CONST_LINE_DY : TITLE_LINE_DY;
          const titleBase = p.y + p.size + labelOffset;
          const step = layout.spineIds.indexOf(id);

          return (
            <g key={id} className={`task-node ${isFocus ? 'task-node-focus' : ''} ${p.kind === 'context' ? 'task-node-context' : ''}`}>
              {/* Step badge (01/02/03) — mono, receded Ash on every spine node so
                  the chain rhythm holds (01/02/03) WITHOUT spending the one brass
                  accent. The locked node's badge sits top-left OUTSIDE the beam
                  and above the reticle's NW tick; the plan nodes keep top-left. */}
              {hasSpine && (p.kind === 'plan' || p.kind === 'focus') && (
                <text
                  x={p.kind === 'focus' ? p.x - p.size - 14 : p.x - p.size - 2}
                  y={p.y - p.size - 2}
                  textAnchor="start"
                  fontFamily={MONO} fontSize={12} fontWeight={600} fill="var(--ash)"
                  style={{ pointerEvents: 'none' }}>
                  {String(step + 1).padStart(2, '0')}
                </text>
              )}

              <circle cx={p.x} cy={p.y} r={p.size} fill={fill} stroke={stroke}
                strokeWidth={strokeWidth} style={{ opacity: op }} title={task?.title || ''} />
              {task?.dueAt && (
                <circle cx={p.x + p.size * 0.72} cy={p.y - p.size * 0.72} r={p.kind === 'context' ? 3.5 : 5}
                  fill={FLAG_COLOR} opacity="0.85" />
              )}
              {/* The lit node's title/duration are carried by the plaque hanging
                  off it; a duplicate on the map would sit behind that card. */}
              {!isFocus && (
                <text x={p.x} y={titleBase} textAnchor="middle" fill={labelColor} fontSize={fontSize}
                  fontWeight={labelWeight} opacity={labelOp} style={{ pointerEvents: 'none' }} title={task?.title || ''}>
                  {lines[0]}
                  {lines.length > 1 && <tspan x={p.x} dy={lineDy}>{lines[1]}</tspan>}
                </text>
              )}
              {p.kind !== 'context' && !isFocus && (
                <text x={p.x} y={p.y + p.size + DURATION_OFFSET} textAnchor="middle"
                  fontFamily={MONO} fontSize={11} fill="var(--ash)" opacity="0.75"
                  style={{ pointerEvents: 'none' }}>
                  {task?.estimatedMinutes}m
                </text>
              )}
            </g>
          );
        })}

        {/* The Lock reticle — one-shot settle around the lit node */}
        {reticle && focus && (
          <g className="reticle" transform={`translate(${focus.x}, ${focus.y})`}>
            <circle className="reticle-ring" cx="0" cy="0" r={reticle.ringR}
              fill="none" stroke="var(--accent)" strokeWidth="1" />
            {reticle.ticks.map(tick => (
              <g key={tick.key} className="reticle-tick"
                style={{
                  '--cx': `${tick.cx}px`, '--cy': `${tick.cy}px`,
                  '--lock-from-x': `${tick.fx}px`, '--lock-from-y': `${tick.fy}px`,
                }}>
                <path d={tick.path} fill="none" stroke="var(--accent)" strokeWidth="1" />
              </g>
            ))}
          </g>
        )}

        {/* Quiet caption footer — mono */}
        <text x={SVG_W / 2} y={layout.captionY} textAnchor="middle"
          fontFamily={MONO} fontSize={12} fill="var(--ash)">
          {caption}
        </text>

        {/* Truthful KEY legend lower-left — mono */}
        <g transform={`translate(20, ${layout.LEGEND_TOP})`}>
          <text x="0" y="0" fontFamily={MONO} fontSize={11} fill="var(--ash)" fontWeight={600}>KEY</text>
          {present.focus && (
            <>
              <circle cx="5" cy="15" r="4.5" fill="var(--warm-gold)" />
              <text x="16" y="19" fontFamily={MONO} fontSize={10} fill="var(--text-primary)">focus</text>
            </>
          )}
          {present.plan && (
            <>
              <circle cx="5" cy="31" r="4.5" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1" />
              <text x="16" y="35" fontFamily={MONO} fontSize={10} fill="var(--text-primary)">in plan</text>
            </>
          )}
          {present.context && (
            <>
              <circle cx="5" cy="47" r="4.5" fill="var(--ash)" opacity="0.55" />
              <text x="16" y="51" fontFamily={MONO} fontSize={10} fill="var(--text-primary)">context</text>
            </>
          )}
          {present.deadline && (
            <>
              <circle cx="5" cy="63" r="4" fill={FLAG_COLOR} />
              <text x="16" y="67" fontFamily={MONO} fontSize={10} fill="var(--text-primary)">deadline</text>
            </>
          )}
        </g>
      </svg>
    </div>
  );
}
