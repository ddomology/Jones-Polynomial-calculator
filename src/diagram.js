// src/diagram.js

const CURVE_SAMPLES_PER_QUAD = 24;
const CROSSING_MERGE_RADIUS = 10;

export function buildDiagramFromEditorState(editorState = {}) {
  const components = normalizeComponents(editorState.components ?? []);
  const crossingOverrides = editorState.crossingOverrides ?? [];

  const rawCrossings = detectRenderedCrossings(components);
  const mergedCrossings = mergeNearbyCrossings(
    rawCrossings,
    CROSSING_MERGE_RADIUS
  );

  mergedCrossings.sort((u, v) => {
    if (u.position.y !== v.position.y) return u.position.y - v.position.y;
    return u.position.x - v.position.x;
  });

  const crossings = mergedCrossings.map((crossing) => {
    const override = crossingOverrides.find((item) => item.key === crossing.key);
    const over = override?.over ?? null;
    const sign = computeCrossingSign(crossing.tangentA, crossing.tangentB, over);

    return {
      ...crossing,
      over,
      sign,
      resolved: over === "a" || over === "b",
    };
  });

  const allResolved =
    crossings.length > 0 &&
    crossings.every((crossing) => crossing.resolved && crossing.sign !== null);

  const writhe = allResolved
    ? crossings.reduce((sum, crossing) => sum + crossing.sign, 0)
    : null;

  return {
    components,
    crossings,
    writhe,
  };
}

function normalizeComponents(rawComponents) {
  return rawComponents.map((component, index) => {
    const points = (component.points ?? []).map(clonePoint);
    const trace = buildRenderedTrace(
      points,
      component.closed !== false,
      index,
      CURVE_SAMPLES_PER_QUAD
    );

    return {
      id: component.id ?? `component-${index + 1}`,
      closed: component.closed !== false,
      points,
      tracePoints: trace.points,
      segments: trace.segments,
    };
  });
}

function detectRenderedCrossings(components) {
  const crossings = [];

  // self crossings
  for (let ci = 0; ci < components.length; ci += 1) {
    const segs = components[ci].segments;

    for (let i = 0; i < segs.length; i += 1) {
      for (let j = i + 1; j < segs.length; j += 1) {
        if (isNearbyPolylineSegment(i, j, segs.length)) continue;

        const hit = segmentIntersection(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (!hit) continue;

        crossings.push(
          makeRenderedCrossing({
            hit,
            segA: segs[i],
            segB: segs[j],
          })
        );
      }
    }
  }

  // crossings between different components
  for (let ca = 0; ca < components.length; ca += 1) {
    for (let cb = ca + 1; cb < components.length; cb += 1) {
      const segsA = components[ca].segments;
      const segsB = components[cb].segments;

      for (let i = 0; i < segsA.length; i += 1) {
        for (let j = 0; j < segsB.length; j += 1) {
          const hit = segmentIntersection(
            segsA[i].a,
            segsA[i].b,
            segsB[j].a,
            segsB[j].b
          );
          if (!hit) continue;

          crossings.push(
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

  return crossings;
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
    over: null,
    sign: null,
    resolved: false,
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

function computeCrossingSign(tangentA, tangentB, over) {
  if (over !== "a" && over !== "b") {
    return null;
  }

  const overTangent = over === "a" ? tangentA : tangentB;
  const underTangent = over === "a" ? tangentB : tangentA;

  const det = cross2(overTangent, underTangent);

  if (Math.abs(det) < 1e-9) {
    return null;
  }

  return det > 0 ? 1 : -1;
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