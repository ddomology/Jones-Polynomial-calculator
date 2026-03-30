// src/editor.js

export function createEditor(canvas, options = {}) {
  if (!canvas) {
    throw new Error("canvas element가 필요하다.");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context를 가져올 수 없다.");
  }

  const onChange =
    typeof options.onChange === "function" ? options.onChange : () => {};
  const onStatus =
    typeof options.onChange === "function" ? options.onChange : () => {};

  const CLOSE_RADIUS = 14;
  const POINT_RADIUS = 5;
  const HIT_RADIUS = 10;
  const CROSSING_HIT_RADIUS = 14;

  const CURVE_SAMPLES_PER_QUAD = 24;
  const CROSSING_MERGE_RADIUS = 10;

  const STROKE_COLOR = "#111827";
  const STROKE_WIDTH = 2.5;
  const COVER_RADIUS = 9;
  const COVER_COLOR = "#e5e7eb";

  const state = {
    mode: options.mode ?? "draw",
    components: [],
    currentPoints: [],
    crossingOverrides: [],
    draggingPoint: null,
    hoverPoint: null,
    hoverCrossingIndex: -1,
  };

  canvas.addEventListener("click", handleClick);
  canvas.addEventListener("mousedown", handleMouseDown);
  canvas.addEventListener("mousemove", handleCanvasMouseMove);
  canvas.addEventListener("mouseleave", handleMouseLeave);
  window.addEventListener("mousemove", handleWindowMouseMove);
  window.addEventListener("mouseup", handleMouseUp);

  render();

  return {
    setMode,
    clear,
    getState,
    loadExample,
  };

  function setMode(mode) {
    state.mode = mode;
    state.draggingPoint = null;
    onStatus(`editor mode: ${mode}`);
    render();
  }

  function clear() {
    state.components = [];
    state.currentPoints = [];
    state.crossingOverrides = [];
    state.draggingPoint = null;
    state.hoverPoint = null;
    state.hoverCrossingIndex = -1;
    render();
    onChange();
  }

  function getState() {
    return {
      mode: state.mode,
      components: state.components.map(cloneComponent),
      currentPoints: state.currentPoints.map(clonePoint),
      crossingOverrides: state.crossingOverrides.map((item) => ({ ...item })),
    };
  }

  function loadExample(example) {
    const firstComponent = (example?.components ?? [])[0];

    state.components = firstComponent
      ? [
          {
            id: firstComponent.id ?? "knot-1",
            closed: firstComponent.closed !== false,
            points: (firstComponent.points ?? []).map(clonePoint),
          },
        ]
      : [];

    state.currentPoints = [];
    state.crossingOverrides = (example?.crossingOverrides ?? []).map((item) => ({
      ...item,
    }));
    state.draggingPoint = null;
    state.hoverPoint = null;
    state.hoverCrossingIndex = -1;

    render();
    onChange();
  }

  function handleClick(event) {
    const p = getCanvasPoint(canvas, event);

    if (state.mode === "draw") {
      handleDrawClick(p);
      return;
    }

    if (state.mode === "crossing") {
      handleCrossingClick(p);
    }
  }

  function handleDrawClick(p) {
    if (state.components.length >= 1) {
      onStatus(
        "knot만 지원한다. 이미 닫힌 곡선이 있어서 더는 점을 추가할 수 없다."
      );
      return;
    }

    if (state.currentPoints.length >= 3) {
      const first = state.currentPoints[0];
      if (distance(p, first) <= CLOSE_RADIUS) {
        finalizeCurrentComponent();
        return;
      }
    }

    state.currentPoints.push(p);
    onStatus(`점 추가: (${round1(p.x)}, ${round1(p.y)})`);
    render();
    onChange();
  }

function finalizeCurrentComponent() {
  if (state.components.length >= 1) {
    onStatus("이미 knot 하나가 완성되어 있다.");
    return;
  }

  if (state.currentPoints.length < 3) {
    onStatus("닫힌 곡선을 만들려면 최소 3개 점이 필요하다.");
    return;
  }

  state.components.push({
    id: "knot-1",
    closed: true,
    points: state.currentPoints.map(clonePoint),
  });

  state.currentPoints = [];
  state.hoverPoint = null;
  state.hoverCrossingIndex = -1;

  state.mode = "crossing";
  onStatus("knot를 닫았다. 교차 지정 모드로 전환한다.");

  render();
  onChange();
}

  function handleCrossingClick(p) {
    const crossings = computeDisplayCrossings();
    const hit = findNearestCrossing(p, crossings, CROSSING_HIT_RADIUS);

    if (!hit) {
      onStatus("교차점이 안 잡혔다.");
      return;
    }

    const crossing = crossings[hit.index];
    const existingIndex = state.crossingOverrides.findIndex(
      (item) => item.key === crossing.key
    );

    if (existingIndex >= 0) {
      const current = state.crossingOverrides[existingIndex];
      current.over = current.over === "a" ? "b" : "a";
      onStatus(`crossing #${hit.index + 1} over 지정: ${current.over}`);
    } else {
      state.crossingOverrides.push({
        key: crossing.key,
        over: "a",
      });
      onStatus(`crossing #${hit.index + 1} over 지정: a`);
    }

    render();
    onChange();
  }

  function handleMouseDown(event) {
    if (state.mode !== "edit") return;

    const p = getCanvasPoint(canvas, event);
    const hit = findNearestEditablePoint(p);

    if (!hit) return;

    state.draggingPoint = hit;
    onStatus("점 드래그 시작");
  }

  function handleCanvasMouseMove(event) {
    const p = getCanvasPoint(canvas, event);

    if (state.mode === "edit" && state.draggingPoint) {
      const targetPoints =
        state.draggingPoint.kind === "component"
          ? state.components[state.draggingPoint.componentIndex].points
          : state.currentPoints;

      targetPoints[state.draggingPoint.pointIndex] = p;
      render();
      onChange();
      return;
    }

    state.hoverPoint = findNearestEditablePoint(p, HIT_RADIUS + 2);

    const crossings = computeDisplayCrossings();
    const hit = findNearestCrossing(p, crossings, CROSSING_HIT_RADIUS);
    state.hoverCrossingIndex = hit ? hit.index : -1;

    render();
  }

  function handleWindowMouseMove(event) {
    if (!(state.mode === "edit" && state.draggingPoint)) return;

    const p = getCanvasPoint(canvas, event);
    const targetPoints =
      state.draggingPoint.kind === "component"
        ? state.components[state.draggingPoint.componentIndex].points
        : state.currentPoints;

    targetPoints[state.draggingPoint.pointIndex] = p;
    render();
    onChange();
  }

  function handleMouseUp() {
    if (!state.draggingPoint) return;

    state.draggingPoint = null;
    onStatus("점 드래그 종료");
    render();
    onChange();
  }

  function handleMouseLeave() {
    state.hoverPoint = null;
    state.hoverCrossingIndex = -1;
    render();
  }

  function findNearestEditablePoint(p, radius = HIT_RADIUS) {
    let best = null;

    for (let ci = 0; ci < state.components.length; ci += 1) {
      const component = state.components[ci];
      for (let pi = 0; pi < component.points.length; pi += 1) {
        const d = distance(p, component.points[pi]);
        if (d <= radius && (!best || d < best.distance)) {
          best = {
            kind: "component",
            componentIndex: ci,
            pointIndex: pi,
            distance: d,
          };
        }
      }
    }

    for (let pi = 0; pi < state.currentPoints.length; pi += 1) {
      const d = distance(p, state.currentPoints[pi]);
      if (d <= radius && (!best || d < best.distance)) {
        best = {
          kind: "current",
          componentIndex: -1,
          pointIndex: pi,
          distance: d,
        };
      }
    }

    return best;
  }

  function computeDisplayCrossings() {
    const components = state.components.map(cloneComponent);
    const traces = components.map((component, componentIndex) =>
      buildRenderedTrace(
        component.points,
        true,
        componentIndex,
        CURVE_SAMPLES_PER_QUAD
      )
    );

    const rawCrossings = [];

    // self-crossings
    for (let ci = 0; ci < traces.length; ci += 1) {
      const segs = traces[ci].segments;

      for (let i = 0; i < segs.length; i += 1) {
        for (let j = i + 1; j < segs.length; j += 1) {
          if (isNearbyPolylineSegment(i, j, segs.length)) continue;

          const hit = segmentIntersection(
            segs[i].a,
            segs[i].b,
            segs[j].a,
            segs[j].b
          );
          if (!hit) continue;

          rawCrossings.push(
            makeRenderedCrossing({
              hit,
              segA: segs[i],
              segB: segs[j],
            })
          );
        }
      }
    }

    // different components (현재 knot only라 거의 안 쓰이지만 남겨둠)
    for (let ca = 0; ca < traces.length; ca += 1) {
      for (let cb = ca + 1; cb < traces.length; cb += 1) {
        const segsA = traces[ca].segments;
        const segsB = traces[cb].segments;

        for (let i = 0; i < segsA.length; i += 1) {
          for (let j = 0; j < segsB.length; j += 1) {
            const hit = segmentIntersection(
              segsA[i].a,
              segsA[i].b,
              segsB[j].a,
              segsB[j].b
            );
            if (!hit) continue;

            rawCrossings.push(
              makeRenderedCrossing({
                hit,
                segA: segsA[i],
                segB: segsB[j],
              })
            );
          }
        }
      }
    }

    const crossings = mergeNearbyCrossings(rawCrossings, CROSSING_MERGE_RADIUS);

    crossings.sort((u, v) => {
      if (u.position.y !== v.position.y) return u.position.y - v.position.y;
      return u.position.x - v.position.x;
    });

    return crossings.map((crossing) => {
      const override = state.crossingOverrides.find(
        (item) => item.key === crossing.key
      );

      return {
        ...crossing,
        over: override?.over ?? null,
      };
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    drawGrid();

    state.components.forEach((component) => {
      drawComponent(component.points, {
        closed: true,
        strokeStyle: STROKE_COLOR,
        pointFillStyle: "#2563eb",
      });
    });

    if (state.currentPoints.length > 0) {
      drawComponent(state.currentPoints, {
        closed: false,
        strokeStyle: "#6b7280",
        pointFillStyle: "#f59e0b",
      });

      drawCircle(
        state.currentPoints[0],
        CLOSE_RADIUS,
        "rgba(16,185,129,0.14)",
        "#10b981",
        1.5
      );
    }

    const crossings = computeDisplayCrossings();
    drawCrossingCovers(crossings);

    if (
      state.mode === "crossing" &&
      state.hoverCrossingIndex >= 0 &&
      crossings[state.hoverCrossingIndex]
    ) {
      drawHoverCrossing(crossings[state.hoverCrossingIndex]);
    }

    if (state.hoverPoint) {
      drawHoverPoint(state.hoverPoint);
    }
  }

  function drawBackground() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const step = 25;

    ctx.save();
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;

    for (let x = 0; x <= canvas.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let y = 0; y <= canvas.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawComponent(points, config) {
    if (!points.length) return;

    ctx.save();
    ctx.strokeStyle = config.strokeStyle;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const mid = midpoint(prev, curr);
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    }

    const last = points[points.length - 1];

    if (config.closed && points.length >= 3) {
      const first = points[0];
      const mid = midpoint(last, first);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.quadraticCurveTo(first.x, first.y, first.x, first.y);
      ctx.closePath();
    } else if (points.length >= 2) {
      ctx.lineTo(last.x, last.y);
    }

    ctx.stroke();

    for (const p of points) {
      ctx.fillStyle = config.pointFillStyle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawCrossingCovers(crossings) {
    for (const crossing of crossings) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        crossing.position.x,
        crossing.position.y,
        COVER_RADIUS,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = COVER_COLOR;
      ctx.fill();
      ctx.restore();

      if (crossing.over !== "a" && crossing.over !== "b") {
        continue;
      }

      const upperBranch =
        crossing.over === "a" ? crossing.branchA : crossing.branchB;
      if (!upperBranch || !upperBranch.piece) continue;

      drawActualUpperArc(
        ctx,
        upperBranch.piece,
        upperBranch.t,
        crossing.position,
        COVER_RADIUS * 1.45,
        STROKE_COLOR,
        STROKE_WIDTH
      );
    }
  }

  function drawHoverCrossing(crossing) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      crossing.position.x,
      crossing.position.y,
      COVER_RADIUS + 3,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = "rgba(59,130,246,0.12)";
    ctx.fill();
    ctx.restore();
  }

  function drawHoverPoint(hit) {
    let point = null;

    if (hit.kind === "component") {
      point =
        state.components[hit.componentIndex]?.points?.[hit.pointIndex] ?? null;
    } else {
      point = state.currentPoints[hit.pointIndex] ?? null;
    }

    if (!point) return;

    drawCircle(point, 9, "rgba(59,130,246,0.10)", "#2563eb", 2);
  }

  function drawCircle(center, radius, fillStyle, strokeStyle, lineWidth = 1) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    ctx.restore();
  }
}

function getCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function findNearestCrossing(p, crossings, radius) {
  let best = null;

  for (let i = 0; i < crossings.length; i += 1) {
    const d = distance(p, crossings[i].position);
    if (d <= radius && (!best || d < best.distance)) {
      best = { index: i, distance: d };
    }
  }

  return best;
}

function makeRenderedCrossing({ hit, segA, segB }) {
  const tangentA = subtract(segA.b, segA.a);
  const tangentB = subtract(segB.b, segB.a);

  const tA = segA.t0 + hit.t * (segA.t1 - segA.t0);
  const tB = segB.t0 + hit.u * (segB.t1 - segB.t0);

  return {
    key: renderedCrossingKey(segA, segB),
    componentA: segA.componentIndex,
    segmentA: segA.sampleIndex,
    componentB: segB.componentIndex,
    segmentB: segB.sampleIndex,
    position: clonePoint(hit),
    tangentA,
    tangentB,
    branchA: {
      piece: segA.piece,
      t: tA,
    },
    branchB: {
      piece: segB.piece,
      t: tB,
    },
    sign: cross2(tangentA, tangentB) >= 0 ? 1 : -1,
    over: null,
  };
}

function mergeNearbyCrossings(crossings, radius) {
  const merged = [];

  for (const crossing of crossings) {
    const existing = merged.find(
      (item) =>
        distance(item.position, crossing.position) <= radius &&
        sameComponentPair(item, crossing)
    );

    if (!existing) {
      merged.push({ ...crossing });
      continue;
    }

    existing.position = {
      x: (existing.position.x + crossing.position.x) / 2,
      y: (existing.position.y + crossing.position.y) / 2,
    };
  }

  return merged;
}

function sameComponentPair(a, b) {
  const p1 = `${a.componentA}|${a.componentB}`;
  const p2 = `${b.componentA}|${b.componentB}`;
  return p1 === p2;
}

function renderedCrossingKey(segA, segB) {
  const left = `${segA.componentIndex}:${segA.sampleIndex}`;
  const right = `${segB.componentIndex}:${segB.sampleIndex}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function isNearbyPolylineSegment(i, j, total) {
  if (Math.abs(i - j) <= 2) return true;
  if (i <= 1 && j >= total - 2) return true;
  if (j <= 1 && i >= total - 2) return true;
  return false;
}

function buildRenderedTrace(points, closed, componentIndex, samplesPerQuad) {
  const pieces = buildCurvePieces(points, closed);
  const sampled = [];
  const segments = [];

  for (let pi = 0; pi < pieces.length; pi += 1) {
    const piece = pieces[pi];
    const divisions = piece.type === "quad" ? samplesPerQuad : 1;

    const localPoints = [];
    for (let k = 0; k <= divisions; k += 1) {
      const t = k / divisions;
      localPoints.push({
        point: evaluatePiece(piece, t),
        t,
      });
    }

    for (let k = 0; k < localPoints.length; k += 1) {
      if (pi > 0 && k === 0) continue;
      sampled.push(localPoints[k].point);
    }

    for (let k = 0; k < localPoints.length - 1; k += 1) {
      segments.push({
        a: localPoints[k].point,
        b: localPoints[k + 1].point,
        componentIndex,
        sampleIndex: segments.length,
        piece,
        pieceIndex: pi,
        t0: localPoints[k].t,
        t1: localPoints[k + 1].t,
      });
    }
  }

  return {
    componentIndex,
    points: sampled,
    segments,
  };
}

function buildCurvePieces(points, closed) {
  const pieces = [];

  if (!points || points.length === 0) {
    return pieces;
  }

  let current = clonePoint(points[0]);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const end = midpoint(prev, curr);

    pieces.push({
      type: "quad",
      p0: clonePoint(current),
      c: clonePoint(prev),
      p1: clonePoint(end),
    });

    current = end;
  }

  const last = points[points.length - 1];

  if (closed && points.length >= 3) {
    const first = points[0];
    const midLF = midpoint(last, first);

    pieces.push({
      type: "quad",
      p0: clonePoint(current),
      c: clonePoint(last),
      p1: clonePoint(midLF),
    });

    pieces.push({
      type: "quad",
      p0: clonePoint(midLF),
      c: clonePoint(first),
      p1: clonePoint(first),
    });
  } else if (points.length >= 2) {
    pieces.push({
      type: "line",
      p0: clonePoint(current),
      p1: clonePoint(last),
    });
  }

  return pieces;
}

function evaluatePiece(piece, t) {
  if (piece.type === "line") {
    return {
      x: piece.p0.x + (piece.p1.x - piece.p0.x) * t,
      y: piece.p0.y + (piece.p1.y - piece.p0.y) * t,
    };
  }

  return evaluateQuadratic(piece.p0, piece.c, piece.p1, t);
}

function evaluateQuadratic(p0, c, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

function drawActualUpperArc(
  ctx,
  piece,
  tCenter,
  centerPoint,
  radius,
  strokeStyle,
  lineWidth
) {
  const tStart = findBoundaryT(piece, tCenter, centerPoint, radius, -1);
  const tEnd = findBoundaryT(piece, tCenter, centerPoint, radius, +1);

  ctx.save();
  ctx.beginPath();

  if (piece.type === "line") {
    const p0 = evaluatePiece(piece, tStart);
    const p1 = evaluatePiece(piece, tEnd);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
  } else if (piece.type === "quad") {
    const sub = subQuadratic(piece, tStart, tEnd);
    ctx.moveTo(sub.p0.x, sub.p0.y);
    ctx.quadraticCurveTo(sub.c.x, sub.c.y, sub.p1.x, sub.p1.y);
  }

  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = strokeStyle;
  ctx.stroke();
  ctx.restore();
}

function findBoundaryT(piece, tCenter, centerPoint, radius, direction) {
  let inside = tCenter;
  let outside = tCenter;
  let step = 0.02;

  while (true) {
    const candidate = clamp01(outside + direction * step);

    if (candidate === outside) {
      return outside;
    }

    const p = evaluatePiece(piece, candidate);
    const d = distance(p, centerPoint);

    if (d >= radius) {
      let lo = inside;
      let hi = candidate;

      if (direction < 0) {
        lo = candidate;
        hi = inside;
      }

      for (let iter = 0; iter < 24; iter += 1) {
        const mid = (lo + hi) / 2;
        const pm = evaluatePiece(piece, mid);
        const dm = distance(pm, centerPoint);

        if (dm < radius) {
          if (direction < 0) {
            hi = mid;
          } else {
            lo = mid;
          }
        } else {
          if (direction < 0) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
      }

      return direction < 0 ? hi : lo;
    }

    inside = candidate;
    outside = candidate;
    step *= 1.35;
  }
}

function subQuadratic(piece, t0, t1) {
  let a = t0;
  let b = t1;

  if (a > b) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  if (Math.abs(a - b) < 1e-10) {
    const p = evaluateQuadratic(piece.p0, piece.c, piece.p1, a);
    return {
      p0: p,
      c: p,
      p1: p,
    };
  }

  const firstSplit = splitQuadraticAt(piece.p0, piece.c, piece.p1, b);
  const left = firstSplit.left;

  const local = b <= 1e-12 ? 0 : a / b;
  const secondSplit = splitQuadraticAt(left.p0, left.c, left.p1, local);

  return secondSplit.right;
}

function splitQuadraticAt(p0, c, p1, t) {
  const p01 = lerpPoint(p0, c, t);
  const p12 = lerpPoint(c, p1, t);
  const p012 = lerpPoint(p01, p12, t);

  return {
    left: {
      type: "quad",
      p0: p0,
      c: p01,
      p1: p012,
    },
    right: {
      type: "quad",
      p0: p012,
      c: p12,
      p1: p1,
    },
  };
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function segmentIntersection(p1, p2, q1, q2) {
  const r = subtract(p2, p1);
  const s = subtract(q2, q1);
  const denom = cross2(r, s);

  if (Math.abs(denom) < 1e-9) return null;

  const qp = subtract(q1, p1);
  const t = cross2(qp, s) / denom;
  const u = cross2(qp, r) / denom;

  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) {
    return null;
  }

  return {
    x: p1.x + t * r.x,
    y: p1.y + t * r.y,
    t,
    u,
  };
}

function cloneComponent(component) {
  return {
    id: component.id,
    closed: component.closed !== false,
    points: (component.points ?? []).map(clonePoint),
  };
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}