// =============================================================================
// MODEL
// -----------------------------------------------------------------------------
// All math and simulation formulas for the simplified election simulator.
// `index.html` is responsible for the DOM, sliders, and rendering; this file
// only contains pure-ish functions that operate on numbers and a `params`
// object.  The simulator's only dependency on the DOM is via `params.epsPct`
// etc., which `readParams` (in index.html) builds from `window.CONFIG`.
//
// Loaded after `config.js` so helpers can read defaults from `window.CONFIG`
// when wiring up the parameter mapping (`buildParamsFromSliders`).
// =============================================================================

// ---------------------------------------------------------------------------
// RNG / MATH HELPERS
// ---------------------------------------------------------------------------
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Bates(3) — sum of three Uniform(-1, +1) draws.  Unit variance, bell-shaped
// near 0 like a Gaussian, but with bounded support [-3, +3] (zero density
// beyond), so the tails are thinner than randn().
function boundedRandn() {
  return (Math.random() * 2 - 1)
       + (Math.random() * 2 - 1)
       + (Math.random() * 2 - 1);
}

// Sample from Gamma(shape, scale=1) via Marsaglia–Tsang for shape ≥ 1, with
// Stuart's "boost" trick for shape < 1: G(k) = G(k+1) · U^(1/k).
function gammaSample(shape) {
  if (shape < 1) {
    const u = Math.max(Math.random(), 1e-300);
    return gammaSample(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1/3;
  const c = 1 / Math.sqrt(9 * d);
  // Marsaglia–Tsang acceptance loop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x, v;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

// Symmetric Subbotin / generalised-normal draw with density
//   f(x) ∝ exp( -|x/α|^β )
// Sampled via |X| = α · Y^(1/β) with Y ~ Gamma(1/β, 1), then a random sign.
//   β = 2 → Gaussian (σ = α/√2)
//   β > 2 → thinner-than-Gaussian tails
//   β → ∞ → Uniform(−α, +α)
function subbotinSample(alpha, beta) {
  const y = gammaSample(1 / beta);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return alpha * sign * Math.pow(y, 1 / beta);
}

// Continuous-N Bates: sum of N Uniform(-1, +1) draws, normalised to unit
// variance (variance of the raw sum is N/3).  Fractional N is achieved by
// adding one extra uniform with probability N - floor(N), so callers can
// dial tightness smoothly.  Bounded (zero density beyond ±√(3N)/√(N/3) =
// ±√3·√N), bell-shaped, and very fast — N+1 calls to Math.random() plus a
// sqrt and a divide.
//   N = 1 → Uniform(-√3, +√3)              (flattest)
//   N = 2 → triangular
//   N = 3 → ≈ Gaussian-on-bounded-support
//   N → ∞ → Gaussian
function batesSample(N) {
  const Nf = Math.floor(N);
  const useExtra = Math.random() < (N - Nf);
  const n = Nf + (useExtra ? 1 : 0);
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.random() * 2 - 1;
  return s / Math.sqrt(n / 3);
}

function sigmoid(x) {
  if (x >= 0) { const e = Math.exp(-x); return 1 / (1 + e); }
  const e = Math.exp(x); return e / (1 + e);
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function mean(a) { let s = 0; for (const x of a) s += x; return s / a.length; }

// erf (Abramowitz & Stegun 7.1.26)
function erf(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741;
  const a4=-1.453152027, a5=1.061405429, pp=0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + pp * ax);
  const y = 1.0 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t * Math.exp(-ax*ax);
  return sign * y;
}

function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

// Inverse standard normal CDF (Acklam)
function probit(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a1=-3.969683028665376e+01, a2=2.209460984245205e+02, a3=-2.759285104469687e+02,
        a4=1.383577518672690e+02, a5=-3.066479806614716e+01, a6=2.506628277459239e+00;
  const b1=-5.447609879822406e+01, b2=1.615858368580409e+02, b3=-1.556989798598866e+02,
        b4=6.680131188771972e+01, b5=-1.328068155288572e+01;
  const c1=-7.784894002430293e-03, c2=-3.223964580411365e-01, c3=-2.400758277161838e+00,
        c4=-2.549732539343734e+00, c5=4.374664141464968e+00, c6=2.938163982698783e+00;
  const d1=7.784695709041462e-03, d2=3.224671290700398e-01, d3=2.445134137142996e+00, d4=3.754408661907416e+00;
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q*q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
}

// ---------------------------------------------------------------------------
// DISTRICTS — deterministic, truncated-Gaussian quantile placement.
// `m` districts on the right half, mirrored to give 2*m + 1 total seats.
// ---------------------------------------------------------------------------
function generateDistricts(m, mu, sigma) {
  const cdfLo = normCdf((0   - mu) / sigma);
  const cdfHi = normCdf((100 - mu) / sigma);
  const half = new Array(m);
  for (let i = 0; i < m; i++) {
    const q = (i + 0.5) / m;
    const u = cdfLo + q * (cdfHi - cdfLo);
    const z = probit(u);
    half[i] = clamp(mu + sigma * z, 1e-6, 100);
  }
  half.sort((a, b) => a - b);
  const N = 2 * m + 1;
  const d = new Array(N);
  for (let i = 0; i < m; i++) d[i] = -half[m - 1 - i];
  d[m] = 0;
  for (let i = 0; i < m; i++) d[m + 1 + i] = half[i];
  return d;
}

// ---------------------------------------------------------------------------
// PARAMETER DERIVATIONS
// Small pure helpers that turn slider values into the derived params
// `simulateOne` consumes.  They take only the numbers they need so they can
// be reused / unit-tested without standing up a full CONFIG object.
// ---------------------------------------------------------------------------

// Anchored linear coupling: at slider position `defaultValue` returns
// `defaultMu`; otherwise μ = defaultMu + slope * (currentValue - defaultValue).
// Used for both the candidate-ideology mean (vs ambient-moderation σ) and the
// district-partisanship mean (vs districtCompet σ).
function anchoredLinear(currentValue, defaultValue, defaultMu, slope) {
  return defaultMu + slope * (currentValue - defaultValue);
}

// Translate the intentional-moderation config into the per-party offsets
// `simulateOne` consumes.  `breadth` is the Gaussian half-decay distance
// (in % points) and is always passed through — it shapes the bell whether
// or not the offsets are zero.
//   mode === 'centered': mean / variance offsets = 0; varAmp = 0.
//   mode === 'offsetK':  D mean peaks at +K, R at −K;
//                        D variance peaks at +L, R at −L; both with `varAmp`.
function intentionalModOffsets(mode, K, L, meanAmp, varAmp, meanBreadth, varBreadth, varModRatio) {
  const useOffset = mode === 'offsetK';
  return {
    modOffsetD:  useOffset ? +K : 0,
    modOffsetR:  useOffset ? -K : 0,
    varOffsetD:  useOffset ? +L : 0,
    varOffsetR:  useOffset ? -L : 0,
    meanAmp,
    varAmp:      useOffset ? varAmp : 0,
    varModRatio,
    meanBreadth,
    varBreadth,
  };
}

// ---------------------------------------------------------------------------
// SIMULATION
// `simulateOne(p, returnFull)` runs one full chamber under params `p`.  When
// `returnFull` is true, also returns per-district arrays for plotting.
// ---------------------------------------------------------------------------
function simulateOne(p, returnFull = false) {
  const d = generateDistricts(p.m, p.muDist, p.sigmaDist);
  const N = d.length;
  const r = returnFull ? new Float64Array(N) : null;
  const party = returnFull ? new Array(N) : null;
  const rVals = new Float64Array(N);
  const partyVals = new Uint8Array(N);

  // Gaussian bells: peak at 1 when d == off and decay with half-decay
  // distance equal to the supplied breadth.  Mean and variance bells use
  // independent breadths so the two effects can be tuned separately.
  const meanBreadthSq = p.meanBreadth * p.meanBreadth;
  const varBreadthSq  = p.varBreadth  * p.varBreadth;
  const bellMean = (d, off) => Math.exp(-((d - off) * (d - off)) / meanBreadthSq);
  const bellVar  = (d, off) => Math.exp(-((d - off) * (d - off)) / varBreadthSq);

  let mismatches = 0;  // R in D-lean district, or D in R-lean district (di ≠ 0)
  for (let i = 0; i < N; i++) {
    const di = d[i];
    // Mean-moderation drive — each party's bell peaks at its configured
    // partisanship offset (`modOffsetD` / `modOffsetR`), width = meanBreadth.
    const bellD_D  = bellMean(di,       p.modOffsetD);
    const bellDV_D = bellMean(di + p.v, p.modOffsetD);
    const bellD_R  = bellMean(di,       p.modOffsetR);
    const bellDV_R = bellMean(di + p.v, p.modOffsetR);
    // Variance bump — separate (typically broader) bell, peaks at the
    // varOffsetD / varOffsetR.  Scaled by the slider (bDs / bRs) AND a
    // varModRatio knob so the user can dial how strongly the slider drives
    // variance vs. the mean.
    //   varModRatio = 1 → variance scales with slider 1:1 (matches mean).
    //   varModRatio = 0 → variance bump killed (slider has no effect on σ).
    const sigmaD_eff = p.sigmaD + p.varAmp * p.varModRatio * p.bDs * bellVar(di, p.varOffsetD);
    const sigmaR_eff = p.sigmaR + p.varAmp * p.varModRatio * p.bRs * bellVar(di, p.varOffsetR);
    const cD =  p.meanAmp * (p.bDs * bellD_D + p.bDc * bellDV_D) + p.muD + sigmaD_eff * randn();
    const cR = -p.meanAmp * (p.bRs * bellD_R + p.bRc * bellDV_R) + p.muR + sigmaR_eff * randn();
    // Election uncertainty: a unit-variance continuous-N Bates draw scaled by
    // `batesW`.  Bounded (no Gaussian-style tail), bell-shaped, and easily
    // tunable via `batesN` (1 = uniform, 3 ≈ Gaussian-on-bounded-support,
    // larger N → closer to true Gaussian).  Sigmoid was replaced with a hard
    // sign cutoff, so this is the only stochastic input to the vote outcome
    // (besides the candidate-ideology randn() draws above).
    const extraNoise = p.batesW
      ? p.batesW * batesSample(p.batesN)
      : 0;
    const z = (p.v + di - p.wMod * (cD + cR)) / p.sigmaN + extraNoise;
    const isR = z > 0 ? 1 : 0;
    const ri = isR ? cR : cD;
    rVals[i] = ri;
    partyVals[i] = isR;
    if (di !== 0 && ((isR && di < 0) || (!isR && di > 0))) mismatches++;
    if (returnFull) { r[i] = ri; party[i] = isR ? 'R' : 'D'; }
  }

  const idxArr = Array.from({ length: N }, (_, i) => i);
  idxArr.sort((a, b) => rVals[a] - rVals[b]);
  const medianIdx = idxArr[(N - 1) >> 1];
  const medianIdeology = rVals[medianIdx];
  const medianParty = partyVals[medianIdx] ? 'R' : 'D';

  let rSeats = 0;
  for (let i = 0; i < N; i++) if (partyVals[i]) rSeats++;

  if (returnFull) return { d, r, party, medianIdeology, medianParty, medianIdx, rSeats, mismatches };
  return { medianIdeology, medianParty, rSeats, mismatches };
}

function runSimulations(p, n) {
  const meds = new Float64Array(n);
  const parties = new Uint8Array(n);
  const seats = new Int32Array(n);
  const mismatches = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    const out = simulateOne(p, false);
    meds[s] = out.medianIdeology;
    parties[s] = out.medianParty === 'R' ? 1 : 0;
    seats[s] = out.rSeats;
    mismatches[s] = out.mismatches;
  }
  // Districts are deterministic, so a single realization suffices for plots.
  const districtPool = generateDistricts(p.m, p.muDist, p.sigmaDist);
  return { meds, parties, seats, mismatches, districtPool };
}
