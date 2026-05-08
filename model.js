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

// Tukey lambda: symmetric distribution defined by its quantile function
//   Q(u) = (u^λ − (1 − u)^λ) / λ        (λ ≠ 0)
//   Q(u) = log(u / (1 − u))              (λ = 0, logistic)
// Sampled directly from a single Uniform(0, 1) — two Math.pow's and a
// subtract per draw, no rejection.  λ controls the shape:
//   λ = 0     → logistic (heavier tails than Gaussian)
//   λ ≈ 0.14  → ≈ standard normal
//   λ = 0.5   → bounded, sub-Gaussian
//   λ = 1     → Uniform(−1, +1)
//   λ → ∞     → degenerate at 0
// Variance is *not* normalised; the caller should scale via an outer
// multiplier and tune to taste.
function tukeyLambdaSample(lambda) {
  const u = Math.random();
  if (lambda === 0) return Math.log(u / (1 - u));
  return (Math.pow(u, lambda) - Math.pow(1 - u, lambda)) / lambda;
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
// DISTRICTS — single-realisation pool drawn from an α-mixture of an
// arbitrary list of Gaussian components.  The pool is one chamber's worth
// of districts, reused across all `nsim` simulations within a render.
//
// `base` shape (from CONFIG.districtBase):
//   {
//     enforceSymmetry: true | false,
//     components: [ { mean, sigma, weight }, ... ],
//   }
//
//   enforceSymmetry: true   – sample m points from the right-half mixture
//     (reject anything < 0 or > 100), sort, mirror to the left half.  The
//     full pool is exactly symmetric and the median is forced to 0.
//
//   enforceSymmetry: false  – sample 2m+1 points from the full mixture
//     (reject anything outside [-100, 100]).  No mirroring: components with
//     non-zero means produce a skewed pool.
//
// `gerry` shape (unchanged):
//   { removeRange: [lo, hi], bumpCenter, bumpSigma, bumpWeight }
//   Removes samples in `removeRange` from the base, replaces them with
//   draws from a Gaussian bump.  Mirroring rules follow `enforceSymmetry`.
//
// Cached by (N, α, base, gerry-fingerprint).
// ---------------------------------------------------------------------------
let _poolCache = { key: null, pool: null };

function _districtPoolKey(N, alpha, base, gerry) {
  const components = base.components || [];
  const enforceSym = !!base.enforceSymmetry;
  const compsKey = components.map(c => `${c.mean ?? 0},${c.sigma},${c.weight}`).join(';');
  return N + '|' + alpha + '|' + (enforceSym ? 'S' : 'A') + '|' + compsKey + '|' +
         gerry.removeRange[0] + '|' + gerry.removeRange[1] + '|' +
         gerry.bumpCenter + '|' + gerry.bumpSigma + '|' + gerry.bumpWeight;
}

// Uncached: actually draws a fresh pool every call.  Used by runSimulations
// to regenerate the district pool periodically (so each render samples many
// realisations of the chamber, not just one).
function sampleDistrictPool(N, alpha, base, gerry) {
  const components = base.components || [];
  const enforceSym = !!base.enforceSymmetry;
  // Pre-compute cumulative component weights for fast weighted picking.
  let totalW = 0;
  for (const c of components) totalW += c.weight;
  const cumW = new Float64Array(components.length);
  let acc = 0;
  for (let i = 0; i < components.length; i++) {
    acc += components[i].weight;
    cumW[i] = acc;
  }
  function pickComponent() {
    const r = Math.random() * totalW;
    for (let i = 0; i < cumW.length; i++) if (r < cumW[i]) return components[i];
    return components[components.length - 1];
  }

  const removeLo = gerry.removeRange[0];
  const removeHi = gerry.removeRange[1];
  // Lower / upper bound of the support depends on whether we're sampling the
  // right half or the full range.
  function sampleBase(loBound, hiBound) {
    const c = pickComponent();
    const mean = c.mean ?? 0;
    let x;
    do { x = mean + c.sigma * randn(); } while (x < loBound || x > hiBound);
    return x;
  }
  // Pure rejection sampling on [loBound, hiBound].  No folding — samples
  // that fall outside support (e.g. the bump's left tail going negative
  // when sampling the right half) are simply redrawn.
  function sampleBump(loBound, hiBound) {
    let x;
    do {
      x = gerry.bumpCenter + gerry.bumpSigma * randn();
    } while (x < loBound || x > hiBound);
    return x;
  }
  // Gerry distribution = (base with removeRange cut out) ∪ bump, with the
  // bump *also* rejected inside removeRange so the conceptual model holds:
  // the gerry component has ZERO density in removeRange, and instead packs
  // the safe-R bump.  Without this, the bump's left tail leaks back into
  // the "vanished" competitive band.
  function sampleOne(loBound, hiBound) {
    if (Math.random() >= alpha) {
      return sampleBase(loBound, hiBound);
    }
    let x;
    if (Math.random() < gerry.bumpWeight) {
      do { x = sampleBump(loBound, hiBound); }
      while (x >= removeLo && x <= removeHi);
      return x;
    }
    do { x = sampleBase(loBound, hiBound); }
    while (x >= removeLo && x <= removeHi);
    return x;
  }

  let pool;
  if (enforceSym) {
    const m = (N - 1) >> 1;
    // Sample m+1 right-half points so the median can come from the
    // distribution naturally instead of being hard-pinned to 0.  The
    // smallest right-half sample (`half[0]`) sits at the median slot —
    // for components centred away from 0 this avoids an artificial
    // spike at the centre of the histogram.  The remaining m points
    // are mirrored to the left half so the pool is still symmetric
    // about the median.
    const half = new Array(m + 1);
    for (let i = 0; i <= m; i++) half[i] = sampleOne(0, 100);
    half.sort((a, b) => a - b);
    pool = new Array(N);
    for (let i = 0; i < m; i++) pool[i] = -half[m - i];
    pool[m] = half[0];
    for (let i = 0; i < m; i++) pool[m + 1 + i] = half[i + 1];
  } else {
    pool = new Array(N);
    for (let i = 0; i < N; i++) pool[i] = sampleOne(-100, 100);
    pool.sort((a, b) => a - b);
  }
  return pool;
}

// Cached wrapper: returns the same pool while (N, alpha, base, gerry) are
// unchanged.  Used by callers that want a deterministic single realisation
// (e.g. simulateOne when called directly without a passed-in pool).
function buildDistrictPool(N, alpha, base, gerry) {
  const key = _districtPoolKey(N, alpha, base, gerry);
  if (_poolCache.key === key) return _poolCache.pool;
  const pool = sampleDistrictPool(N, alpha, base, gerry);
  _poolCache = { key, pool };
  return pool;
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
function simulateOne(p, returnFull = false, districtPool = null) {
  // Districts are deterministic given (m, muDist, sigmaDist).  When
  // simulateOne is called from runSimulations, the caller passes the
  // pre-computed pool to avoid regenerating it per simulation.
  const d = districtPool || buildDistrictPool(2 * p.m + 1, p.alpha, p.base, p.gerry);
  const N = d.length;
  const r = returnFull ? new Float64Array(N) : null;
  const party = returnFull ? new Array(N) : null;
  const rVals = new Float64Array(N);
  const partyVals = new Uint8Array(N);

  // Hoist all `p.X` reads out of the inner loop so V8 keeps the constants
  // in registers / locals instead of re-walking the params object N times.
  const v = p.v;
  const muD = p.muD, muR = p.muR, sigmaD = p.sigmaD, sigmaR = p.sigmaR;
  const bDs = p.bDs, bDc = p.bDc, bRs = p.bRs, bRc = p.bRc;
  const wMod = p.wMod, sigmaN = p.sigmaN;
  const meanAmp = p.meanAmp;
  const varScale = p.varAmp * p.varModRatio;
  const modOffsetD = p.modOffsetD, modOffsetR = p.modOffsetR;
  const varOffsetD = p.varOffsetD, varOffsetR = p.varOffsetR;
  const meanBreadthSq = p.meanBreadth * p.meanBreadth;
  const varBreadthSq  = p.varBreadth  * p.varBreadth;
  const noiseType = p.noiseType;
  const batesW = p.batesW, batesN = p.batesN;
  const tukeyW = p.tukeyW, tukeyLambda = p.tukeyLambda;
  // Combine bDs+bDc and bRs+bRc into the v=0 fast path: when v == 0 the +v
  // bells equal the base bells, so meanAmp · (bDs + bDc) · bell collapses to
  // a single multiplied bell.  We pick the right scalar once outside the loop.
  const vIsZero = v === 0;
  const meanScaleD = vIsZero ? meanAmp * (bDs + bDc) : meanAmp;
  const meanScaleR = vIsZero ? meanAmp * (bRs + bRc) : meanAmp;

  let mismatches = 0;  // R in D-lean district, or D in R-lean district (di ≠ 0)
  if (vIsZero) {
    // Fast path — only 2 mean bells per district instead of 4.
    for (let i = 0; i < N; i++) {
      const di = d[i];
      const aD  = di - modOffsetD;
      const aR  = di - modOffsetR;
      const bellD_D = Math.exp(-(aD * aD) / meanBreadthSq);
      const bellD_R = Math.exp(-(aR * aR) / meanBreadthSq);
      const aVD = di - varOffsetD;
      const aVR = di - varOffsetR;
      const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthSq);
      const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthSq);
      const sigmaD_eff = sigmaD + varScale * bDs * bellVar_D;
      const sigmaR_eff = sigmaR + varScale * bRs * bellVar_R;
      const cD =  meanScaleD * bellD_D + muD + sigmaD_eff * randn();
      const cR = -meanScaleR * bellD_R + muR + sigmaR_eff * randn();
      let extraNoise = 0;
      if (noiseType === 'tukey') {
        if (tukeyW) extraNoise = tukeyW * tukeyLambdaSample(tukeyLambda);
      } else {
        if (batesW) extraNoise = batesW * batesSample(batesN);
      }
      const z = (di - wMod * (cD + cR)) / sigmaN + extraNoise;
      const isR = z > 0 ? 1 : 0;
      const ri = isR ? cR : cD;
      rVals[i] = ri;
      partyVals[i] = isR;
      if (di !== 0 && ((isR && di < 0) || (!isR && di > 0))) mismatches++;
      if (returnFull) { r[i] = ri; party[i] = isR ? 'R' : 'D'; }
    }
  } else for (let i = 0; i < N; i++) {
    const di = d[i];
    const aD  = di - modOffsetD;
    const aR  = di - modOffsetR;
    const aDV = di + v - modOffsetD;
    const aRV = di + v - modOffsetR;
    const bellD_D  = Math.exp(-(aD  * aD ) / meanBreadthSq);
    const bellD_R  = Math.exp(-(aR  * aR ) / meanBreadthSq);
    const bellDV_D = Math.exp(-(aDV * aDV) / meanBreadthSq);
    const bellDV_R = Math.exp(-(aRV * aRV) / meanBreadthSq);
    // Variance-bump bells.
    const aVD = di - varOffsetD;
    const aVR = di - varOffsetR;
    const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthSq);
    const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthSq);
    const sigmaD_eff = sigmaD + varScale * bDs * bellVar_D;
    const sigmaR_eff = sigmaR + varScale * bRs * bellVar_R;
    const cD =  meanAmp * (bDs * bellD_D + bDc * bellDV_D) + muD + sigmaD_eff * randn();
    const cR = -meanAmp * (bRs * bellD_R + bRc * bellDV_R) + muR + sigmaR_eff * randn();
    // Election uncertainty.  Replaces the old sigmoid → Math.random; we now
    // hard-cut on z.
    let extraNoise = 0;
    if (noiseType === 'tukey') {
      if (tukeyW) extraNoise = tukeyW * tukeyLambdaSample(tukeyLambda);
    } else {
      if (batesW) extraNoise = batesW * batesSample(batesN);
    }
    const z = (v + di - wMod * (cD + cR)) / sigmaN + extraNoise;
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

// Number of consecutive simulations that share a single district-pool
// realisation before a new one is sampled.  At 1, every sim gets a fresh
// pool (slowest, most variance).  At nsim, all sims share one pool (fastest,
// least variance — original behaviour).  50 covers ~nsim/POOL_REUSE distinct
// chambers per render — enough variance to break the lock to a single
// realisation without dominating the per-sim cost.
const POOL_REUSE = 50;

function runSimulations(p, n) {
  const meds = new Float64Array(n);
  const parties = new Uint8Array(n);
  const seats = new Int32Array(n);
  const mismatches = new Int32Array(n);
  const N = 2 * p.m + 1;
  // Resample the district pool every POOL_REUSE simulations so a render
  // averages over many chambers rather than locking to one realisation.
  let districtPool = sampleDistrictPool(N, p.alpha, p.base, p.gerry);
  for (let s = 0; s < n; s++) {
    if (s > 0 && s % POOL_REUSE === 0) {
      districtPool = sampleDistrictPool(N, p.alpha, p.base, p.gerry);
    }
    const out = simulateOne(p, false, districtPool);
    meds[s] = out.medianIdeology;
    parties[s] = out.medianParty === 'R' ? 1 : 0;
    seats[s] = out.rSeats;
    mismatches[s] = out.mismatches;
  }
  return { meds, parties, seats, mismatches, districtPool };
}
