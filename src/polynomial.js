// src/polynomial.js

export function computeJonesData(diagram) {
  if (!diagram) {
    throw new Error("diagram이 필요하다.");
  }

  const crossings = diagram.crossings ?? [];
  const components = diagram.components ?? [];

  if (crossings.length === 0) {
    const one = makePolynomial({ 0: 1 });
    return {
      bracket: one,
      bracketString: "1",
      jones: one,
      jonesString: "1",
    };
  }

  const unresolved = crossings.some(
    (crossing) => crossing.over !== "a" && crossing.over !== "b"
  );

  if (unresolved) {
    throw new Error("모든 crossing의 over/under를 먼저 지정해야 한다.");
  }

  if (diagram.writhe === null || diagram.writhe === undefined) {
    throw new Error("writhe를 계산할 수 없다.");
  }

  if (crossings.length > 18) {
    throw new Error(
      "crossing이 너무 많다. 현재 구현은 상태합이라 18개 이하 정도만 권장한다."
    );
  }

  const topology = buildTopology(components, crossings);
  const bracket = computeBracketPolynomial(topology, crossings.length);
  const normalizedA = normalizeByWrithe(bracket, diagram.writhe);
  const jones = convertAPolynomialToT(normalizedA);

  return {
    bracket,
    bracketString: formatAPolynomial(bracket),
    jones,
    jonesString: formatTPolynomial(jones),
  };
}

function buildTopology(components, crossings) {
  const eventsByComponent = new Map();
  const crossingData = [];
  const portIds = new Set();
  const continuationEdges = [];
  let zeroCrossingComponents = 0;

  for (let ci = 0; ci < components.length; ci += 1) {
    eventsByComponent.set(ci, []);
  }

  for (let i = 0; i < crossings.length; i += 1) {
    const crossing = crossings[i];

    const occA = `${i}:a`;
    const occB = `${i}:b`;

    const segA = components[crossing.componentA]?.segments?.[crossing.segmentA];
    const segB = components[crossing.componentB]?.segments?.[crossing.segmentB];

    if (!segA || !segB) {
      throw new Error("crossing이 참조하는 segment를 찾을 수 없다.");
    }

    const entryA = {
      occurrenceId: occA,
      crossingIndex: i,
      branch: "a",
      componentIndex: crossing.componentA,
      segmentIndex: crossing.segmentA,
      param: parameterOnSegment(segA, crossing.position),
    };

    const entryB = {
      occurrenceId: occB,
      crossingIndex: i,
      branch: "b",
      componentIndex: crossing.componentB,
      segmentIndex: crossing.segmentB,
      param: parameterOnSegment(segB, crossing.position),
    };

    eventsByComponent.get(crossing.componentA).push(entryA);
    eventsByComponent.get(crossing.componentB).push(entryB);

    portIds.add(portInId(occA));
    portIds.add(portOutId(occA));
    portIds.add(portInId(occB));
    portIds.add(portOutId(occB));

    crossingData.push(buildCrossingResolutionData(i, crossing));
  }

  for (let ci = 0; ci < components.length; ci += 1) {
    const events = eventsByComponent.get(ci) ?? [];

    if (events.length === 0) {
      zeroCrossingComponents += 1;
      continue;
    }

    events.sort(compareEventsOnComponent);

    for (let k = 0; k < events.length; k += 1) {
      const current = events[k];
      const next = events[(k + 1) % events.length];

      continuationEdges.push([
        portOutId(current.occurrenceId),
        portInId(next.occurrenceId),
      ]);
    }
  }

  return {
    portIds,
    continuationEdges,
    crossingData,
    zeroCrossingComponents,
  };
}

function buildCrossingResolutionData(crossingIndex, crossing) {
  const occA = `${crossingIndex}:a`;
  const occB = `${crossingIndex}:b`;

  const overBranch = crossing.over;
  const underBranch = overBranch === "a" ? "b" : "a";

  const overOccurrenceId = overBranch === "a" ? occA : occB;
  const underOccurrenceId = overBranch === "a" ? occB : occA;

  const overTangent = overBranch === "a" ? crossing.tangentA : crossing.tangentB;
  const underTangent = underBranch === "a" ? crossing.tangentA : crossing.tangentB;

  const det = cross2(overTangent, underTangent);

  const leftUnderPort = det > 0 ? "out" : "in";
  const rightUnderPort = leftUnderPort === "out" ? "in" : "out";

  const zeroResolutionPairs = [
    [portInId(overOccurrenceId), portId(underOccurrenceId, leftUnderPort)],
    [portOutId(overOccurrenceId), portId(underOccurrenceId, rightUnderPort)],
  ];

  const oneResolutionPairs = [
    [portInId(overOccurrenceId), portId(underOccurrenceId, rightUnderPort)],
    [portOutId(overOccurrenceId), portId(underOccurrenceId, leftUnderPort)],
  ];

  return {
    crossingIndex,
    zeroResolutionPairs,
    oneResolutionPairs,
  };
}

function computeBracketPolynomial(topology, crossingCount) {
  const delta = makePolynomial({
    2: -1,
    [-2]: -1,
  });

  const deltaPowerCache = new Map();
  deltaPowerCache.set(0, makePolynomial({ 0: 1 }));

  const stateCount = 2 ** crossingCount;
  let total = makeZeroPolynomial();

  for (let mask = 0; mask < stateCount; mask += 1) {
    const loops = countLoopsForState(topology, mask);
    const s1 = popcount(mask);
    const s0 = crossingCount - s1;

    const shift = s0 - s1;
    const loopPoly = getCachedPower(deltaPowerCache, delta, loops - 1);
    const weighted = shiftPolynomial(loopPoly, shift);

    total = addPolynomials(total, weighted);
  }

  return simplifyPolynomial(total);
}

function countLoopsForState(topology, mask) {
  const uf = new UnionFind();

  for (const portIdValue of topology.portIds) {
    uf.add(portIdValue);
  }

  for (const [u, v] of topology.continuationEdges) {
    uf.union(u, v);
  }

  for (let i = 0; i < topology.crossingData.length; i += 1) {
    const crossing = topology.crossingData[i];
    const bit = (mask >> i) & 1;

    const pairs =
      bit === 0 ? crossing.zeroResolutionPairs : crossing.oneResolutionPairs;

    for (const [u, v] of pairs) {
      uf.union(u, v);
    }
  }

  return topology.zeroCrossingComponents + uf.countRoots();
}

function parameterOnSegment(segment, point) {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const denom = dx * dx + dy * dy;

  if (denom < 1e-12) {
    return 0;
  }

  const px = point.x - segment.a.x;
  const py = point.y - segment.a.y;

  return (px * dx + py * dy) / denom;
}

function compareEventsOnComponent(a, b) {
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex - b.segmentIndex;
  }
  return a.param - b.param;
}

function portId(occurrenceId, side) {
  return `${occurrenceId}:${side}`;
}

function portInId(occurrenceId) {
  return portId(occurrenceId, "in");
}

function portOutId(occurrenceId) {
  return portId(occurrenceId, "out");
}

function normalizeByWrithe(bracketPoly, writhe) {
  const shift = -3 * writhe;
  const sign = isOdd(3 * writhe) ? -1 : 1;

  return simplifyPolynomial(
    scalePolynomial(shiftPolynomial(bracketPoly, shift), sign)
  );
}

function convertAPolynomialToT(polyA) {
  const result = new Map();

  for (const [expAKey, coeff] of polyA.entries()) {
    const expA = Number(expAKey);
    const tNumerator = -expA;

    if (coeff === 0) continue;

    result.set(tNumerator, (result.get(tNumerator) ?? 0) + coeff);
  }

  return simplifyPolynomial(result);
}

function formatAPolynomial(poly) {
  return formatPolynomial(poly, (exp) => formatPower("A", exp, 1));
}

function formatTPolynomial(poly) {
  return formatPolynomial(poly, (numerator) =>
    formatRationalPower("t", numerator, 4)
  );
}

function formatPolynomial(poly, powerFormatter) {
  const entries = [...poly.entries()]
    .map(([exp, coeff]) => [Number(exp), coeff])
    .filter(([, coeff]) => coeff !== 0)
    .sort((a, b) => b[0] - a[0]);

  if (entries.length === 0) {
    return "0";
  }

  const terms = entries.map(([exp, coeff], index) => {
    const absCoeff = Math.abs(coeff);
    const power = powerFormatter(exp);

    let core = "";
    if (power === "1") {
      core = String(absCoeff);
    } else if (absCoeff === 1) {
      core = power;
    } else {
      core = `${absCoeff}${power}`;
    }

    if (index === 0) {
      return coeff < 0 ? `-${core}` : core;
    }

    return coeff < 0 ? `- ${core}` : `+ ${core}`;
  });

  const chunkSize = 4;
  const lines = [];

  for (let i = 0; i < terms.length; i += chunkSize) {
    lines.push(terms.slice(i, i + chunkSize).join(" "));
  }

  if (lines.length === 1) {
    return lines[0];
  }

  return String.raw`\begin{gathered}` +
    lines.join(String.raw`\\`) +
    String.raw`\end{gathered}`;
}
function formatPower(variable, exp, denominator) {
  if (exp === 0) return "1";

  if (denominator === 1) {
    if (exp === 1) return variable;
    return `${variable}^{${exp}}`;
  }

  return formatRationalPower(variable, exp, denominator);
}

function formatRationalPower(variable, numerator, denominator) {
  if (numerator === 0) return "1";

  const reduced = reduceFraction(numerator, denominator);
  const n = reduced.n;
  const d = reduced.d;

  if (d === 1) {
    if (n === 1) return variable;
    return `${variable}^{${n}}`;
  }

  if (n === 1) {
    return `${variable}^{\\frac{1}{${d}}}`;
  }

  if (n === -1) {
    return `${variable}^{-\\frac{1}{${d}}}`;
  }

  if (n < 0) {
    return `${variable}^{-\\frac{${Math.abs(n)}}{${d}}}`;
  }

  return `${variable}^{\\frac{${n}}{${d}}}`;
}

function reduceFraction(n, d) {
  const g = gcd(Math.abs(n), Math.abs(d));
  const nn = n / g;
  const dd = d / g;

  if (dd < 0) {
    return { n: -nn, d: -dd };
  }

  return { n: nn, d: dd };
}

function gcd(a, b) {
  let x = a;
  let y = b;

  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }

  return x || 1;
}

function getCachedPower(cache, base, exponent) {
  if (exponent < 0) {
    throw new Error("delta의 음수 거듭제곱은 지원하지 않는다.");
  }

  if (cache.has(exponent)) {
    return cache.get(exponent);
  }

  const value = powPolynomial(base, exponent);
  cache.set(exponent, value);
  return value;
}

function powPolynomial(poly, exponent) {
  let result = makePolynomial({ 0: 1 });
  let base = poly;
  let exp = exponent;

  while (exp > 0) {
    if (exp % 2 === 1) {
      result = multiplyPolynomials(result, base);
    }
    base = multiplyPolynomials(base, base);
    exp = Math.floor(exp / 2);
  }

  return result;
}

function makeZeroPolynomial() {
  return new Map();
}

function makePolynomial(objectLike) {
  const poly = new Map();

  for (const [exp, coeff] of Object.entries(objectLike)) {
    const n = Number(coeff);
    if (n !== 0) {
      poly.set(Number(exp), n);
    }
  }

  return poly;
}

function addPolynomials(a, b) {
  const result = new Map(a);

  for (const [exp, coeff] of b.entries()) {
    result.set(exp, (result.get(exp) ?? 0) + coeff);
  }

  return simplifyPolynomial(result);
}

function scalePolynomial(poly, scalar) {
  const result = new Map();

  for (const [exp, coeff] of poly.entries()) {
    const value = coeff * scalar;
    if (value !== 0) {
      result.set(exp, value);
    }
  }

  return result;
}

function shiftPolynomial(poly, shift) {
  const result = new Map();

  for (const [exp, coeff] of poly.entries()) {
    result.set(Number(exp) + shift, coeff);
  }

  return result;
}

function multiplyPolynomials(a, b) {
  const result = new Map();

  for (const [expA, coeffA] of a.entries()) {
    for (const [expB, coeffB] of b.entries()) {
      const exp = Number(expA) + Number(expB);
      const coeff = coeffA * coeffB;
      result.set(exp, (result.get(exp) ?? 0) + coeff);
    }
  }

  return simplifyPolynomial(result);
}

function simplifyPolynomial(poly) {
  const result = new Map();

  for (const [exp, coeff] of poly.entries()) {
    if (coeff !== 0) {
      result.set(Number(exp), coeff);
    }
  }

  return result;
}

function popcount(x) {
  let n = x;
  let count = 0;

  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }

  return count;
}

function isOdd(n) {
  return Math.abs(n % 2) === 1;
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  add(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x) {
    const parent = this.parent.get(x);
    if (parent === x) return x;

    const root = this.find(parent);
    this.parent.set(x, root);
    return root;
  }

  union(a, b) {
    this.add(a);
    this.add(b);

    const ra = this.find(a);
    const rb = this.find(b);

    if (ra === rb) return;

    const rankA = this.rank.get(ra);
    const rankB = this.rank.get(rb);

    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  countRoots() {
    const roots = new Set();

    for (const key of this.parent.keys()) {
      roots.add(this.find(key));
    }

    return roots.size;
  }
}