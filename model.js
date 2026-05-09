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
	let u = 0,
		v = 0;
	while (u === 0) u = Math.random();
	while (v === 0) v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Bates(3) — sum of three Uniform(-1, +1) draws.  Unit variance, bell-shaped
// near 0 like a Gaussian, but with bounded support [-3, +3] (zero density
// beyond), so the tails are thinner than randn().
function boundedRandn() {
	return (
		Math.random() * 2 -
		1 +
		(Math.random() * 2 - 1) +
		(Math.random() * 2 - 1)
	);
}

// Sample from Gamma(shape, scale=1) via Marsaglia–Tsang for shape ≥ 1, with
// Stuart's "boost" trick for shape < 1: G(k) = G(k+1) · U^(1/k).
function gammaSample(shape) {
	if (shape < 1) {
		const u = Math.max(Math.random(), 1e-300);
		return gammaSample(shape + 1) * Math.pow(u, 1 / shape);
	}
	const d = shape - 1 / 3;
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
	const useExtra = Math.random() < N - Nf;
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
	if (x >= 0) {
		const e = Math.exp(-x);
		return 1 / (1 + e);
	}
	const e = Math.exp(x);
	return e / (1 + e);
}

function clamp(x, lo, hi) {
	return Math.max(lo, Math.min(hi, x));
}

function mean(a) {
	let s = 0;
	for (const x of a) s += x;
	return s / a.length;
}

// erf (Abramowitz & Stegun 7.1.26)
function erf(x) {
	const a1 = 0.254829592,
		a2 = -0.284496736,
		a3 = 1.421413741;
	const a4 = -1.453152027,
		a5 = 1.061405429,
		pp = 0.3275911;
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1.0 / (1.0 + pp * ax);
	const y =
		1.0 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
	return sign * y;
}

function normCdf(z) {
	return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse standard normal CDF (Acklam)
function probit(p) {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a1 = -3.969683028665376e1,
		a2 = 2.209460984245205e2,
		a3 = -2.759285104469687e2,
		a4 = 1.38357751867269e2,
		a5 = -3.066479806614716e1,
		a6 = 2.506628277459239;
	const b1 = -5.447609879822406e1,
		b2 = 1.615858368580409e2,
		b3 = -1.556989798598866e2,
		b4 = 6.680131188771972e1,
		b5 = -1.328068155288572e1;
	const c1 = -7.784894002430293e-3,
		c2 = -3.223964580411365e-1,
		c3 = -2.400758277161838,
		c4 = -2.549732539343734,
		c5 = 4.374664141464968,
		c6 = 2.938163982698783;
	const d1 = 7.784695709041462e-3,
		d2 = 3.224671290700398e-1,
		d3 = 2.445134137142996,
		d4 = 3.754408661907416;
	const pLow = 0.02425,
		pHigh = 1 - pLow;
	let q, r;
	if (p < pLow) {
		q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
			((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
		);
	} else if (p <= pHigh) {
		q = p - 0.5;
		r = q * q;
		return (
			((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
			(((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
		);
	} else {
		q = Math.sqrt(-2 * Math.log(1 - p));
		return (
			-(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
			((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
		);
	}
}

// ---------------------------------------------------------------------------
// DISTRICTS — one chamber's worth of districts, reused across all `nsim`
// simulations within a render.  The pool's underlying distribution is the
// linear mixture
//
//   density(x) = (1 − rGerry − dGerry) · base(x)
//              +  rGerry              · gerry-R(x)
//              +  dGerry              · gerry-D(x)
//
// where `rGerry` and `dGerry` are absolute weights in [0, 0.5] (the UI caps
// each at 0.5 so they can't add to more than 1).  Both gerry components have
// a shared `removeRange` zeroed out — the band of competitive seats vanishes
// from the gerry portion.
//
// `base` shape (from CONFIG.districtBase):
//   {
//     enforceSymmetry: true | false,
//     components: [ { mean, sigma, weight }, ... ],
//   }
//   enforceSymmetry: true  – the base density is symmetrised about 0
//     (replaced with 0.5·b(x) + 0.5·b(−x)) before mixing, so the base
//     contribution to the pool is exactly symmetric.
//   enforceSymmetry: false – base is used as-is.
//
// `gerry` shape:
//   {
//     removeRange: [lo, hi],
//     componentsR: [ { mean, sigma, weight }, ... ],   // R-favoured packing
//     componentsD: [ { mean, sigma, weight }, ... ],   // D-favoured packing
//   }
//   The gerry density is always asymmetric (no enforceSymmetry).
//
// Cached by (N, rGerry, dGerry, base, gerry-fingerprint).
// ---------------------------------------------------------------------------
let _poolCache = { key: null, pool: null };

function _componentsKey(components) {
	return (components || [])
		.map((c) => `${c.mean ?? 0},${c.sigma},${c.weight}`)
		.join(";");
}

function _districtPoolKey(N, rGerry, dGerry, base, gerry) {
	const sym = base.enforceSymmetry ? "S" : "A";
	return (
		N +
		"|" +
		rGerry +
		"|" +
		dGerry +
		"|" +
		sym +
		"|" +
		_componentsKey(base.components) +
		"|" +
		gerry.removeRange[0] +
		"|" +
		gerry.removeRange[1] +
		"|" +
		_componentsKey(gerry.componentsR) +
		"|" +
		_componentsKey(gerry.componentsD)
	);
}

// Build a weighted-picker closure for a list of `{ mean, sigma, weight }`
// components.  The returned function draws one rejection-sampled value
// inside [loBound, hiBound] from the mixture.
function _buildMixtureSampler(components) {
	const comps = components || [];
	let totalW = 0;
	for (const c of comps) totalW += c.weight;
	const cumW = new Float64Array(comps.length);
	let acc = 0;
	for (let i = 0; i < comps.length; i++) {
		acc += comps[i].weight;
		cumW[i] = acc;
	}
	function pick() {
		const r = Math.random() * totalW;
		for (let i = 0; i < cumW.length; i++) if (r < cumW[i]) return comps[i];
		return comps[comps.length - 1];
	}
	return function sample(loBound, hiBound) {
		const c = pick();
		const mean = c.mean ?? 0;
		let x;
		do {
			x = mean + c.sigma * randn();
		} while (x < loBound || x > hiBound);
		return x;
	};
}

// Monte-Carlo sampler — draws a fresh pool every call by independent samples
// from base / gerry-R / gerry-D in proportion to (1 − rGerry − dGerry),
// rGerry, dGerry.  Kept around mostly for diagnostic / debugging use; the
// main path goes through `analyticDistrictPool` below for noise-free output.
function sampleDistrictPool(N, rGerry, dGerry, base, gerry) {
	const enforceSym = !!base.enforceSymmetry;
	const sampleBaseMix = _buildMixtureSampler(base.components);
	const sampleGerryRMix = _buildMixtureSampler(gerry.componentsR);
	const sampleGerryDMix = _buildMixtureSampler(gerry.componentsD);
	const removeLo = gerry.removeRange[0];
	const removeHi = gerry.removeRange[1];

	// Clamp so weights are valid even if the caller doesn't enforce the cap.
	const wR = Math.max(0, rGerry);
	const wD = Math.max(0, dGerry);
	const wB = Math.max(0, 1 - wR - wD);

	// Deterministic split into nBase / nR / nD.  Match the mixture weights in
	// expectation; per-render granularity is 1/N ≈ 0.23%.
	const nBase = Math.round((N * wB) / (wB + wR + wD || 1));
	const nR = Math.round((N * wR) / (wB + wR + wD || 1));
	const nD = N - nBase - nR;

	const pool = new Array(N);
	let idx = 0;

	// ---- BASE portion (symmetric draw if enforceSym) ----
	if (enforceSym && nBase > 0) {
		const halfCount = nBase >> 1;
		const isOdd = (nBase & 1) === 1;
		const drawCount = halfCount + (isOdd ? 1 : 0);
		const half = new Array(drawCount);
		for (let i = 0; i < drawCount; i++) half[i] = sampleBaseMix(0, 100);
		half.sort((a, b) => a - b);
		if (isOdd) {
			pool[idx++] = half[0];
			for (let i = 1; i <= halfCount; i++) {
				pool[idx++] = half[i];
				pool[idx++] = -half[i];
			}
		} else {
			for (let i = 0; i < halfCount; i++) {
				pool[idx++] = half[i];
				pool[idx++] = -half[i];
			}
		}
	} else {
		for (let i = 0; i < nBase; i++) pool[idx++] = sampleBaseMix(-100, 100);
	}

	// ---- GERRY R portion ----
	for (let i = 0; i < nR; i++) {
		let x;
		do {
			x = sampleGerryRMix(-100, 100);
		} while (x >= removeLo && x <= removeHi);
		pool[idx++] = x;
	}
	// ---- GERRY D portion ----
	for (let i = 0; i < nD; i++) {
		let x;
		do {
			x = sampleGerryDMix(-100, 100);
		} while (x >= removeLo && x <= removeHi);
		pool[idx++] = x;
	}

	pool.sort((a, b) => a - b);
	return pool;
}

// ---------------------------------------------------------------------------
// ANALYTIC POOL
// Instead of Monte-Carlo-sampling the chamber and averaging batches together
// to smooth out noise, compute the pool's i-th order statistic exactly from
// the underlying mixture's CDF.  Build a fine-grid discretisation of the
// pool's density, accumulate to a CDF, then linearly invert it at the N
// evenly-spaced quantiles q_i = (i + 0.5) / N.  Result: zero sampling noise,
// fully deterministic, and faster than one random pool.
// ---------------------------------------------------------------------------

const ANALYTIC_NCELLS = 4000; // midpoint cells across [-100, 100]
const ANALYTIC_LO = -100;
const ANALYTIC_HI = 100;

function _gaussianPdf(x, mean, sigma) {
	const z = (x - mean) / sigma;
	return Math.exp(-0.5 * z * z) / (sigma * 2.5066282746310002) /* √(2π) */;
}

// Mixture density at x for a list of `{ mean, sigma, weight }` components.
// Renormalised so the weights need only be relative.
function _mixturePdf(x, components) {
	if (!components || components.length === 0) return 0;
	let d = 0,
		w = 0;
	for (const c of components) {
		d += c.weight * _gaussianPdf(x, c.mean ?? 0, c.sigma);
		w += c.weight;
	}
	return w > 0 ? d / w : 0;
}

function analyticDistrictPool(N, rGerry, dGerry, base, gerry) {
	const enforceSym = !!base.enforceSymmetry;
	const baseComps = base.components || [];
	const gR = gerry.componentsR || [];
	const gD = gerry.componentsD || [];
	// Clamp into the valid simplex {wB, wR, wD ≥ 0, wB+wR+wD = 1}.
	const wR = Math.max(0, rGerry);
	const wD = Math.max(0, dGerry);
	const wB = Math.max(0, 1 - wR - wD);
	const removeLo = gerry.removeRange[0];
	const removeHi = gerry.removeRange[1];

	function baseDens(x) {
		const d = _mixturePdf(x, baseComps);
		return enforceSym ? 0.5 * (d + _mixturePdf(-x, baseComps)) : d;
	}
	function gerryRDens(x) {
		if (x >= removeLo && x <= removeHi) return 0;
		return _mixturePdf(x, gR);
	}
	function gerryDDens(x) {
		if (x >= removeLo && x <= removeHi) return 0;
		return _mixturePdf(x, gD);
	}

	// Build the pool's CDF using midpoint-cell integration so the integration
	// is exactly symmetric around 0 for symmetric densities (no boundary
	// double-count of x = 0 vs x = -100/+100).  Each cell has width `step`
	// and is sampled at its midpoint x_i = lo + (i + 0.5)·step.  cdf[i]
	// represents P(X ≤ rightEdge of cell i) = P(X < lo + (i + 1)·step).
	const step = (ANALYTIC_HI - ANALYTIC_LO) / ANALYTIC_NCELLS;
	const cdf = new Float64Array(ANALYTIC_NCELLS);
	let acc = 0;
	for (let i = 0; i < ANALYTIC_NCELLS; i++) {
		const x = ANALYTIC_LO + (i + 0.5) * step;
		acc += wB * baseDens(x) + wR * gerryRDens(x) + wD * gerryDDens(x);
		cdf[i] = acc;
	}
	const total = cdf[ANALYTIC_NCELLS - 1];
	if (!isFinite(total) || total <= 0) {
		// Degenerate config (zero density everywhere) — return a flat pool at 0.
		return new Array(N).fill(0);
	}
	for (let i = 0; i < ANALYTIC_NCELLS; i++) cdf[i] /= total;

	// Sweep the cells forward in lockstep with increasing target quantiles —
	// O(N + grid) total.  Linear-interpolate between the bracketing cell
	// right-edges for sub-cell precision.
	const out = new Array(N);
	let gi = 0;
	for (let i = 0; i < N; i++) {
		const q = (i + 0.5) / N;
		while (gi < ANALYTIC_NCELLS - 1 && cdf[gi] < q) gi++;
		const cHi = cdf[gi];
		const cLo = gi > 0 ? cdf[gi - 1] : 0;
		const xHi = ANALYTIC_LO + (gi + 1) * step; // right edge of cell gi
		out[i] = cHi === cLo ? xHi : xHi - (step * (cHi - q)) / (cHi - cLo);
	}
	return out;
}

// Cached wrapper: returns the same pool while (N, rGerry, dGerry, base,
// gerry) are unchanged.  The analytic pool is deterministic so caching is a
// pure speed-up — it's already the same output every call for a given key.
function buildDistrictPool(N, rGerry, dGerry, base, gerry) {
	const key = _districtPoolKey(N, rGerry, dGerry, base, gerry);
	if (_poolCache.key === key) return _poolCache.pool;
	const pool = analyticDistrictPool(N, rGerry, dGerry, base, gerry);
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
//   mode === 'centered': mean / variance offsets = 0; the caller should
//                        also force the per-party amplitudes to 0.
//   mode === 'offsetK':  D mean peaks at +K, R at −K;
//                        D variance peaks at +L, R at −L.
// (Per-party amplitudes are computed in readParams via anchoredLinear and
// passed to simulateOne as meanAmpD / meanAmpR / varAmpD / varAmpR — see
// the candidateMean coupling for the same anchored-default pattern.
// `varAmp*` is added directly to σ (one standard deviation), not to σ².
function intentionalModOffsets(mode, K, L, meanBreadth, varBreadth) {
	const useOffset = mode === "offsetK";
	return {
		mode,
		modOffsetD: useOffset ? +K : 0,
		modOffsetR: useOffset ? -K : 0,
		varOffsetD: useOffset ? +L : 0,
		varOffsetR: useOffset ? -L : 0,
		meanBreadth,
		varBreadth,
	};
}

// ---------------------------------------------------------------------------
// SIMULATION
// `simulateOne(p, returnFull)` runs one full chamber under params `p`.  When
// `returnFull` is true, also returns per-district arrays for plotting.
// ---------------------------------------------------------------------------
// `mismatchTracker`, when provided, is `{ binIdxByDistrict, rInD, dInR }` —
// pre-computed bin indices and accumulators that get bumped per mismatched
// district.  Lets runSimulations build the per-bin mismatch chart data as a
// byproduct of the main run, eliminating the separate "see more plots" pass.
//
// `electedTracker`, when provided, is `{ lo, binSize, nBins, dCounts, rCounts }` —
// bins the ELECTED rep's ideology per district, separated by which party won
// the seat.  Lets the see-more-plots section render per-party distributions
// of the actual representatives that get sent to the chamber.
function simulateOne(
	p,
	returnFull = false,
	districtPool = null,
	mismatchTracker = null,
	electedTracker = null
) {
	// Districts are deterministic given (m, muDist, sigmaDist).  When
	// simulateOne is called from runSimulations, the caller passes the
	// pre-computed pool to avoid regenerating it per simulation.
	const d =
		districtPool ||
		buildDistrictPool(2 * p.m + 1, p.rGerry, p.dGerry, p.base, p.gerry);
	const N = d.length;
	const r = returnFull ? new Float64Array(N) : null;
	const party = returnFull ? new Array(N) : null;
	const rVals = new Float64Array(N);
	const partyVals = new Uint8Array(N);

	// Hoist all `p.X` reads out of the inner loop so V8 keeps the constants
	// in registers / locals instead of re-walking the params object N times.
	const v = p.v;
	const muD = p.muD,
		muR = p.muR,
		sigmaD = p.sigmaD,
		sigmaR = p.sigmaR;
	const wMod = p.wMod,
		sigmaN = p.sigmaN;
	// Per-party intentional-moderation amplitudes — already anchored at the
	// slider default by `readParams`, so the inner loop doesn't multiply them
	// by the slider value or any extra ratio factor.
	const meanAmpD = p.meanAmpD,
		meanAmpR = p.meanAmpR;
	const varAmpD = p.varAmpD,
		varAmpR = p.varAmpR;
	// K and L offsets are anchored at the MEDIAN DISTRICT'S lean, not at 0.
	// The pool is sorted, so its midpoint is the median.  D moderates most
	// at (median + K), R at (median - K); same shift for the σ-bump L.
	// For symmetric pools the median ≈ 0 and this collapses to the old
	// configured-K-from-zero behaviour.
	const medianLean = d[(N - 1) >> 1];
	const modOffsetD = medianLean + p.modOffsetD;
	const modOffsetR = medianLean + p.modOffsetR;
	const varOffsetD = medianLean + p.varOffsetD;
	const varOffsetR = medianLean + p.varOffsetR;
	const meanBreadthSq = p.meanBreadth * p.meanBreadth;
	const varBreadthSq = p.varBreadth * p.varBreadth;
	const noiseType = p.noiseType;
	const batesN = p.batesN;
	const tukeyLambda = p.tukeyLambda;
	// When v == 0 the +v bell equals the base bell, so the two-bell sum
	// (swing + competitive) collapses to twice the base bell — we fold the
	// factor of 2 into the scale once outside the loop.
	const vIsZero = v === 0;
	const meanScaleD = vIsZero ? meanAmpD * 2 : meanAmpD;
	const meanScaleR = vIsZero ? meanAmpR * 2 : meanAmpR;

	// Hoist mismatch-tracker fields to locals so the per-district bumps are
	// tight pointer-array writes (no property lookup in the hot loop).  In
	// addition to the mismatched-only counts (rInD, dInR), we also tally
	// total wins per bin per party (rWins, dWins) so the renderer can show
	// the full who-won-where distribution, not just the mismatched subset.
	const mtBins = mismatchTracker ? mismatchTracker.binIdxByDistrict : null;
	const mtRInD = mismatchTracker ? mismatchTracker.rInD : null;
	const mtDInR = mismatchTracker ? mismatchTracker.dInR : null;
	const mtRWins = mismatchTracker ? mismatchTracker.rWins : null;
	const mtDWins = mismatchTracker ? mismatchTracker.dWins : null;
	// Elected-rep ideology tracker: per district, only the winner's ideology
	// gets binned, separated by their party.  Hoist locals for the hot loop.
	const atDCounts = electedTracker ? electedTracker.dCounts : null;
	const atRCounts = electedTracker ? electedTracker.rCounts : null;
	const atLo = electedTracker ? electedTracker.lo : 0;
	const atStep = electedTracker ? electedTracker.binSize : 1;
	const atNBins = electedTracker ? electedTracker.nBins : 0;
	let mismatches = 0; // R in D-lean district, or D in R-lean district (di ≠ 0)
	if (vIsZero) {
		// Fast path — only 2 mean bells per district instead of 4.
		for (let i = 0; i < N; i++) {
			const di = d[i];
			const aD = di - modOffsetD;
			const aR = di - modOffsetR;
			const bellD_D = Math.exp(-(aD * aD) / meanBreadthSq);
			const bellD_R = Math.exp(-(aR * aR) / meanBreadthSq);
			const aVD = di - varOffsetD;
			const aVR = di - varOffsetR;
			const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthSq);
			const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthSq);
			const sigmaD_eff = sigmaD + varAmpD * bellVar_D;
			const sigmaR_eff = sigmaR + varAmpR * bellVar_R;
			const cD = meanScaleD * bellD_D + muD + sigmaD_eff * randn();
			const cR = -meanScaleR * bellD_R + muR + sigmaR_eff * randn();
			// sigmaN is the σ of the additive election-noise term: a unit-variance
			// shape (Bates or Tukey) scaled by sigmaN and added to the score.
			const noise =
				sigmaN > 0
					? noiseType === "tukey"
						? tukeyLambdaSample(tukeyLambda)
						: batesSample(batesN)
					: 0;
			const z = di - wMod * (cD + cR) + sigmaN * noise;
			// Hard cutoff at z = 0; randomise on exact ties so a perfectly
			// symmetric setup (e.g. rGerry === dGerry, v = 0) has no
			// deterministic bias in who wins the marginal seat.
			const isR = z > 0 || (z === 0 && Math.random() < 0.5) ? 1 : 0;
			const ri = isR ? cR : cD;
			rVals[i] = ri;
			partyVals[i] = isR;
			if (mtBins) {
				const bi = mtBins[i];
				if (isR) mtRWins[bi]++;
				else mtDWins[bi]++;
			}
			if (atDCounts) {
				let bi = ((ri - atLo) / atStep) | 0;
				if (bi < 0) bi = 0;
				else if (bi >= atNBins) bi = atNBins - 1;
				if (isR) atRCounts[bi]++;
				else atDCounts[bi]++;
			}
			if (di !== 0 && ((isR && di < 0) || (!isR && di > 0))) {
				mismatches++;
				if (mtBins) {
					const bi = mtBins[i];
					if (isR) mtRInD[bi]++;
					else mtDInR[bi]++;
				}
			}
			if (returnFull) {
				r[i] = ri;
				party[i] = isR ? "R" : "D";
			}
		}
	} else
		for (let i = 0; i < N; i++) {
			const di = d[i];
			const aD = di - modOffsetD;
			const aR = di - modOffsetR;
			const aDV = di + v - modOffsetD;
			const aRV = di + v - modOffsetR;
			const bellD_D = Math.exp(-(aD * aD) / meanBreadthSq);
			const bellD_R = Math.exp(-(aR * aR) / meanBreadthSq);
			const bellDV_D = Math.exp(-(aDV * aDV) / meanBreadthSq);
			const bellDV_R = Math.exp(-(aRV * aRV) / meanBreadthSq);
			// Variance-bump bells.
			const aVD = di - varOffsetD;
			const aVR = di - varOffsetR;
			const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthSq);
			const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthSq);
			const sigmaD_eff = sigmaD + varAmpD * bellVar_D;
			const sigmaR_eff = sigmaR + varAmpR * bellVar_R;
			const cD =
				meanAmpD * (bellD_D + bellDV_D) + muD + sigmaD_eff * randn();
			const cR =
				-meanAmpR * (bellD_R + bellDV_R) + muR + sigmaR_eff * randn();
			// sigmaN is the σ of the additive election-noise term (see fast-path
			// comment above).
			const noise =
				sigmaN > 0
					? noiseType === "tukey"
						? tukeyLambdaSample(tukeyLambda)
						: batesSample(batesN)
					: 0;
			const z = v + di - wMod * (cD + cR) + sigmaN * noise;
			const isR = z > 0 ? 1 : 0;
			const ri = isR ? cR : cD;
			rVals[i] = ri;
			partyVals[i] = isR;
			if (mtBins) {
				const bi = mtBins[i];
				if (isR) mtRWins[bi]++;
				else mtDWins[bi]++;
			}
			if (atDCounts) {
				let bi = ((ri - atLo) / atStep) | 0;
				if (bi < 0) bi = 0;
				else if (bi >= atNBins) bi = atNBins - 1;
				if (isR) atRCounts[bi]++;
				else atDCounts[bi]++;
			}
			if (di !== 0 && ((isR && di < 0) || (!isR && di > 0))) {
				mismatches++;
				if (mtBins) {
					const bi = mtBins[i];
					if (isR) mtRInD[bi]++;
					else mtDInR[bi]++;
				}
			}
			if (returnFull) {
				r[i] = ri;
				party[i] = isR ? "R" : "D";
			}
		}

	// Seat count + true chamber median by ideology.  We sort all 435 ideologies
	// and take position m.  An earlier "fast path" picked min(R) or max(D)
	// based on which party held the majority, but that only equals the true
	// median when D and R don't overlap in ideology AND the majority is
	// razor-thin (rSeats == m or m+1).  With high intMod or strong qualImp
	// the ideology distributions overlap, and with one side winning by many
	// seats the median sits well inside the majority's pool, not on its
	// boundary — so we just sort.  N=435 is small; per-sim cost is fine.
	let rSeats = 0;
	for (let i = 0; i < N; i++) if (partyVals[i]) rSeats++;
	const m = (N - 1) >> 1;
	const sortedR = Array.from(rVals).sort((a, b) => a - b);
	const medianIdeology = sortedR[m];
	// Find the district index that produced this median ideology.  Ties (which
	// can happen with bounded noise) are rare; first match wins.
	let medianIdx = -1;
	for (let i = 0; i < N; i++) {
		if (rVals[i] === medianIdeology) {
			medianIdx = i;
			break;
		}
	}
	const medianParty = partyVals[medianIdx] ? "R" : "D";

	if (returnFull)
		return {
			d,
			r,
			party,
			medianIdeology,
			medianParty,
			medianIdx,
			rSeats,
			mismatches,
		};
	return { medianIdeology, medianParty, rSeats, mismatches };
}

// `mismatchBinSpec`, when provided, is `{ binSize, lo, hi }` — the bins the
// caller wants per-bin mismatch counts (R-in-D-lean, D-in-R-lean) accumulated
// into across all `n` simulations.  Result is returned as
// `{ rInD, dInR, distCounts, centres, ranges, binSize }`.  This is what the
// "see more plots" mismatch chart reads, so it can reuse the main 1000-sim
// run instead of doing its own pass.
//
// `electedBinSpec`, when provided, is `{ binSize, lo, hi }` for the elected
// rep ideology histogram, split by party (only the winner of each district
// gets counted, into the bin matching their party).  Returned in the result
// object as `electedBins` with `dCounts`, `rCounts`, `centres`, `ranges`,
// plus per-chamber averages `avgD` / `avgR`.
function runSimulations(p, n, mismatchBinSpec = null, electedBinSpec = null) {
	const meds = new Float64Array(n);
	const parties = new Uint8Array(n);
	const seats = new Int32Array(n);
	const mismatches = new Int32Array(n);
	const N = 2 * p.m + 1;
	const m = (N - 1) >> 1;
	// Analytic pool: i-th district = quantile (i + 0.5) / N of the underlying
	// mixture's CDF.  No Monte-Carlo noise, deterministic, reused for all `n`
	// simulations.  Reads as the "expected chamber" given the current sliders.
	const districtPool = analyticDistrictPool(
		N,
		p.rGerry,
		p.dGerry,
		p.base,
		p.gerry
	);
	// The median-district partisanship is now the same for every sim — single
	// value repeated across the array (kept array-shaped so renderStats can
	// use the same code path).
	const medianDistParts = new Float64Array(n).fill(districtPool[m]);

	// Build the optional mismatch-bin tracker.  Pre-compute each district's
	// bin index once so the inner loop just does one array bump per mismatch.
	let mismatchTracker = null;
	let mismatchBins = null;
	if (mismatchBinSpec) {
		const { binSize, lo, hi } = mismatchBinSpec;
		const nBins = Math.max(1, Math.round((hi - lo) / binSize));
		const binIdxByDistrict = new Int32Array(N);
		for (let i = 0; i < N; i++) {
			const di = districtPool[i];
			let idx = Math.floor((di - lo) / binSize);
			if (idx < 0) idx = 0;
			else if (idx >= nBins) idx = nBins - 1;
			binIdxByDistrict[i] = idx;
		}
		const rInD = new Float64Array(nBins);
		const dInR = new Float64Array(nBins);
		const rWins = new Float64Array(nBins);
		const dWins = new Float64Array(nBins);
		mismatchTracker = { binIdxByDistrict, rInD, dInR, rWins, dWins };
		// District counts per bin (excluding di === 0 to mirror the mismatch
		// convention) and bin geometry for the renderer.
		const distCounts = new Int32Array(nBins);
		for (let i = 0; i < N; i++) {
			if (districtPool[i] === 0) continue;
			distCounts[binIdxByDistrict[i]]++;
		}
		const centres = new Array(nBins);
		const ranges = new Array(nBins);
		for (let i = 0; i < nBins; i++) {
			const a = lo + i * binSize;
			const b = a + binSize;
			centres[i] = (a + b) / 2;
			ranges[i] = [a, b];
		}
		mismatchBins = {
			rInD,
			dInR,
			rWins,
			dWins,
			distCounts,
			centres,
			ranges,
			binSize,
			nBins,
		};
	}

	// Optional elected-rep ideology tracker (per-party).
	let electedTracker = null;
	let electedBins = null;
	if (electedBinSpec) {
		const { binSize, lo, hi } = electedBinSpec;
		const nBins = Math.max(1, Math.round((hi - lo) / binSize));
		const dCounts = new Float64Array(nBins);
		const rCounts = new Float64Array(nBins);
		electedTracker = { dCounts, rCounts, lo, binSize, nBins };
		const centres = new Array(nBins);
		const ranges = new Array(nBins);
		for (let i = 0; i < nBins; i++) {
			const a = lo + i * binSize;
			const b = a + binSize;
			centres[i] = (a + b) / 2;
			ranges[i] = [a, b];
		}
		electedBins = { dCounts, rCounts, centres, ranges, binSize, nBins };
	}

	for (let s = 0; s < n; s++) {
		const out = simulateOne(
			p,
			false,
			districtPool,
			mismatchTracker,
			electedTracker
		);
		meds[s] = out.medianIdeology;
		parties[s] = out.medianParty === "R" ? 1 : 0;
		seats[s] = out.rSeats;
		mismatches[s] = out.mismatches;
	}

	// After the loop, normalise per-bin counts to per-chamber averages.
	if (mismatchBins) {
		const nB = mismatchBins.nBins;
		const avgRInD = new Array(nB);
		const avgDInR = new Array(nB);
		const avgRWins = new Array(nB);
		const avgDWins = new Array(nB);
		for (let i = 0; i < nB; i++) {
			avgRInD[i] = mismatchBins.rInD[i] / n;
			avgDInR[i] = mismatchBins.dInR[i] / n;
			avgRWins[i] = mismatchBins.rWins[i] / n;
			avgDWins[i] = mismatchBins.dWins[i] / n;
		}
		mismatchBins.avgRInD = avgRInD;
		mismatchBins.avgDInR = avgDInR;
		mismatchBins.avgRWins = avgRWins;
		mismatchBins.avgDWins = avgDWins;
		mismatchBins.nSims = n;
	}

	// Normalise elected-rep counts to per-chamber averages.
	if (electedBins) {
		const nB = electedBins.nBins;
		const avgD = new Array(nB);
		const avgR = new Array(nB);
		for (let i = 0; i < nB; i++) {
			avgD[i] = electedBins.dCounts[i] / n;
			avgR[i] = electedBins.rCounts[i] / n;
		}
		electedBins.avgD = avgD;
		electedBins.avgR = avgR;
		electedBins.nSims = n;
	}

	return {
		meds,
		parties,
		seats,
		mismatches,
		districtPool,
		medianDistParts,
		mismatchBins,
		electedBins,
	};
}
