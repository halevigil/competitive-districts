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

// Standard Laplace draw (mean 0, scale 1; variance = 2).  Heavier tails than
// the Gaussian — useful for adding "moderate-tail" structure on top of the
// normal candidate-ideology noise.  Stretches into long-shot candidates a
// few times per chamber instead of essentially never.
function laplaceSample() {
	// Inverse-CDF method: u ~ Uniform(0, 1), x = -sign(u − 0.5)·log(1 − 2|u − 0.5|).
	const u = Math.random() - 0.5;
	return u >= 0
		? -Math.log(Math.max(1 - 2 * u, 1e-300))
		:  Math.log(Math.max(1 + 2 * u, 1e-300));
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
function intentionalModOffsets(mode, K, L) {
	const useOffset = mode === "offsetK";
	return {
		mode,
		modOffsetD: useOffset ? +K : 0,
		modOffsetR: useOffset ? -K : 0,
		varOffsetD: useOffset ? +L : 0,
		varOffsetR: useOffset ? -L : 0,
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
//
// `marginTracker`, when provided, is `{ lo, binSize, nBins, dCounts, rCounts }` —
// same shape as electedTracker but bins the per-district election score `z`
// (clipped to [lo, hi]).  z carries district lean + candidate-quality
// adjustment + noise, and is the simulator's analog of a vote margin.
// Useful for the "Distribution of per-district election margins" view that
// parallels the historical House margin chart.
function simulateOne(
	p,
	returnFull = false,
	districtPool = null,
	mismatchTracker = null,
	electedTracker = null,
	marginTracker = null
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
	// Per-party squared breadths so each party's bell width scales with its
	// own intMod slider.
	const meanBreadthDSq = p.meanBreadthD * p.meanBreadthD;
	const meanBreadthRSq = p.meanBreadthR * p.meanBreadthR;
	const varBreadthDSq  = p.varBreadthD  * p.varBreadthD;
	const varBreadthRSq  = p.varBreadthR  * p.varBreadthR;
	const noiseType = p.noiseType;
	const batesN = p.batesN;
	const tukeyLambda = p.tukeyLambda;
	// Candidate-ideology tail: always-on Laplace scale plus a per-party
	// stretch-territory growth term.  The growth is 0 at d_i = medianLean
	// and grows linearly with how far d_i sits on the OTHER party's side
	// of the median — i.e. D candidates fan out in R-leaning districts,
	// R candidates fan out in D-leaning districts.  Slope is configured
	// per party (tied to its intMod slider in readParams).
	const tailBase = p.candidateTailScale;
	const tailGrowthD = p.tailGrowthD;
	const tailGrowthR = p.tailGrowthR;
	// Cap on the stretch distance fed into the tail-growth term — once
	// d_i is `tailGrowthSaturation` % points past the median on the other
	// party's side, growth stops.  Infinity disables the cap.
	const tailGrowthSaturation = p.tailGrowthSaturation ?? Infinity;
	// Same-party safe-district mean pull: in OWN-side safe territory,
	// pull candidates toward the centre by safeAmp · own-side-stretch,
	// capped at safeAmpSaturation.  Each party adds the pull on its own
	// side (D in di < medianLean, R in di > medianLean).
	const safeAmpD = p.safeAmpD ?? 0;
	const safeAmpR = p.safeAmpR ?? 0;
	const safeAmpSaturation = p.safeAmpSaturation ?? Infinity;
	// Scales how much meanAmp's bell adds to the tail.  Per-party (driven by
	// each side's intMod slider via anchoredLinear in readParams).  0 = mean
	// pull doesn't touch the tail; 1 = one unit of Laplace scale per unit of
	// meanAmp at the bell's peak.
	const meanAmpTailFactorD = p.meanAmpTailFactorD ?? 0;
	const meanAmpTailFactorR = p.meanAmpTailFactorR ?? 0;
	// Intentional moderation anchors on d_i + waveWeight·v.  waveWeight = 0
	// recovers the pure-district-lean anchor (intMod ignores the wave);
	// waveWeight = 1 makes intMod fully wave-adjusted; values in between
	// blend.  v already enters the z-score directly for who-wins-each-
	// district; this knob is just about WHERE candidates moderate.
	const waveWeight = p.waveWeight ?? 0;
	const vShift = waveWeight * v;
	const vIsZero = v === 0;

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
	// Per-district margin tracker: bins z (clamped) split by which side won.
	const mgDCounts = marginTracker ? marginTracker.dCounts : null;
	const mgRCounts = marginTracker ? marginTracker.rCounts : null;
	const mgLo = marginTracker ? marginTracker.lo : 0;
	const mgStep = marginTracker ? marginTracker.binSize : 1;
	const mgNBins = marginTracker ? marginTracker.nBins : 0;
	let mismatches = 0; // R in D-lean district, or D in R-lean district (di ≠ 0)
	if (vIsZero) {
		// Fast path — only 2 mean bells per district instead of 4.
		for (let i = 0; i < N; i++) {
			const di = d[i];
			const aD = di - modOffsetD;
			const aR = di - modOffsetR;
			const bellD_D = Math.exp(-(aD * aD) / meanBreadthDSq);
			const bellD_R = Math.exp(-(aR * aR) / meanBreadthRSq);
			const aVD = di - varOffsetD;
			const aVR = di - varOffsetR;
			const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthDSq);
			const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthRSq);
			const sigmaD_eff = sigmaD + varAmpD * bellVar_D;
			const sigmaR_eff = sigmaR + varAmpR * bellVar_R;
			// Stretch territory grows linearly forever — D's grow tail when
			// they're in an R-leaning district (di > medianLean), R's grow
			// tail when they're in a D-leaning district (di < medianLean).
			// On top of that, meanAmp (the intentional-moderation pull) ALSO
			// widens the tail at its bell, so wherever the moderation push is
			// strong the candidates also fan out more — "some try hard, some
			// don't" heterogeneity at the same locations where the pull happens.
			const stretchD = di > medianLean
				? Math.min(di - medianLean, tailGrowthSaturation)
				: 0;
			const stretchR = di < medianLean
				? Math.min(medianLean - di, tailGrowthSaturation)
				: 0;
			// Own-side safe stretch: D's safe territory is di < medianLean,
			// R's is di > medianLean.  Pull toward 0 grows linearly with
			// own-side distance, capped at safeAmpSaturation.
			const safeStretchD = di < medianLean
				? Math.min(medianLean - di, safeAmpSaturation)
				: 0;
			const safeStretchR = di > medianLean
				? Math.min(di - medianLean, safeAmpSaturation)
				: 0;
			const tailScaleD = tailBase + tailGrowthD * stretchD + meanAmpTailFactorD * meanAmpD * bellD_D;
			const tailScaleR = tailBase + tailGrowthR * stretchR + meanAmpTailFactorR * meanAmpR * bellD_R;
			const cD = meanAmpD * bellD_D + safeAmpD * safeStretchD + muD + sigmaD_eff * randn() + tailScaleD * laplaceSample();
			const cR = -meanAmpR * bellD_R - safeAmpR * safeStretchR + muR + sigmaR_eff * randn() + tailScaleR * laplaceSample();
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
			if (mgDCounts) {
				let bi = ((z - mgLo) / mgStep) | 0;
				if (bi < 0) bi = 0;
				else if (bi >= mgNBins) bi = mgNBins - 1;
				if (isR) mgRCounts[bi]++;
				else mgDCounts[bi]++;
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
			// Bell-center "effective district" — d_i + waveWeight·v.  At
			// waveWeight=0 this is just d_i (intMod ignores the wave); at 1
			// it's d_i + v (intMod fully wave-adjusted); intermediate values
			// blend.  Stretch territory below uses the raw d_i — "is this
			// district really hostile to me" doesn't depend on the wave.
			const diEff = di + vShift;
			const aD = diEff - modOffsetD;
			const aR = diEff - modOffsetR;
			const bellD_D = Math.exp(-(aD * aD) / meanBreadthDSq);
			const bellD_R = Math.exp(-(aR * aR) / meanBreadthRSq);
			// Variance-bump bells use the same wave-blended anchor.
			const aVD = diEff - varOffsetD;
			const aVR = diEff - varOffsetR;
			const bellVar_D = Math.exp(-(aVD * aVD) / varBreadthDSq);
			const bellVar_R = Math.exp(-(aVR * aVR) / varBreadthRSq);
			const sigmaD_eff = sigmaD + varAmpD * bellVar_D;
			const sigmaR_eff = sigmaR + varAmpR * bellVar_R;
			// Stretch territory grows linearly forever, plus meanAmp adds a
			// tail bump at the same bell where it pulls the mean.  Anchored
			// at d_i alone (not d_i + v) — see header comment.
			const stretchD = di > medianLean
				? Math.min(di - medianLean, tailGrowthSaturation)
				: 0;
			const stretchR = di < medianLean
				? Math.min(medianLean - di, tailGrowthSaturation)
				: 0;
			// Own-side safe stretch (see fast-path comment).
			const safeStretchD = di < medianLean
				? Math.min(medianLean - di, safeAmpSaturation)
				: 0;
			const safeStretchR = di > medianLean
				? Math.min(di - medianLean, safeAmpSaturation)
				: 0;
			const tailScaleD = tailBase + tailGrowthD * stretchD + meanAmpTailFactorD * meanAmpD * bellD_D;
			const tailScaleR = tailBase + tailGrowthR * stretchR + meanAmpTailFactorR * meanAmpR * bellD_R;
			const cD =
				meanAmpD * bellD_D + safeAmpD * safeStretchD + muD + sigmaD_eff * randn() + tailScaleD * laplaceSample();
			const cR =
				-meanAmpR * bellD_R - safeAmpR * safeStretchR + muR + sigmaR_eff * randn() + tailScaleR * laplaceSample();
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
			if (mgDCounts) {
				let bi = ((z - mgLo) / mgStep) | 0;
				if (bi < 0) bi = 0;
				else if (bi >= mgNBins) bi = mgNBins - 1;
				if (isR) mgRCounts[bi]++;
				else mgDCounts[bi]++;
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
	const dSeats = N - rSeats;
	const m = (N - 1) >> 1;
	const sortedR = Array.from(rVals).sort((a, b) => a - b);
	const medianIdeology = sortedR[m];
	// 1/3 and 2/3 percentile reps by ideology.  Brackets the chamber's
	// moderate band — at wide majority widths the 50th-percentile rep is
	// deep inside one party's pool, so the thirds give the actual range.
	const p33Ideology = sortedR[Math.floor(N / 3)];
	const p67Ideology = sortedR[Math.floor((2 * N) / 3)];
	// Per-party median ideology — the most-moderate / median member of each
	// caucus.  D occupies the bottom dSeats positions of sortedR (the D and
	// R distributions don't overlap when intMod is moderate), so the D
	// median is at sortedR[dSeats >> 1] and the R median is offset by
	// dSeats from the start of the R block.  When intMod is strong enough
	// to put a few D reps above some R reps, this is approximate — but the
	// per-party medians still describe the typical caucus ideology.  Hastert-
	// rule territory: legislation moves at the majority's median, not the
	// chamber median.
	let dMedianIdeology = NaN;
	let rMedianIdeology = NaN;
	if (dSeats > 0 || rSeats > 0) {
		// Pull the D and R subsequences out of the per-district arrays and
		// sort each.  N is small enough that two extra sorts are cheap.
		const dSorted = new Float64Array(dSeats);
		const rSorted = new Float64Array(rSeats);
		let di = 0, ri = 0;
		for (let i = 0; i < N; i++) {
			if (partyVals[i]) rSorted[ri++] = rVals[i];
			else dSorted[di++] = rVals[i];
		}
		if (dSeats > 0) {
			dSorted.sort();
			dMedianIdeology = dSorted[(dSeats - 1) >> 1];
		}
		if (rSeats > 0) {
			rSorted.sort();
			rMedianIdeology = rSorted[(rSeats - 1) >> 1];
		}
	}
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
			p33Ideology,
			p67Ideology,
			dMedianIdeology,
			rMedianIdeology,
			medianParty,
			medianIdx,
			rSeats,
			mismatches,
		};
	return {
		medianIdeology,
		p33Ideology,
		p67Ideology,
		dMedianIdeology,
		rMedianIdeology,
		medianParty,
		rSeats,
		mismatches,
	};
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
//
// `marginBinSpec`, same shape — bins per-district election scores `z`,
// split by D-won / R-won.  Returned as `marginBins`.
function runSimulations(
	p,
	n,
	mismatchBinSpec = null,
	electedBinSpec = null,
	marginBinSpec = null
) {
	const meds = new Float64Array(n);
	const p33s = new Float64Array(n);
	const p67s = new Float64Array(n);
	const dMeds = new Float64Array(n);
	const rMeds = new Float64Array(n);
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
	// Tie-break maps: only relevant when the chamber is fully gerrymandered
	// (rGerry = dGerry = 0.5 → no base contribution at all → no district
	// naturally lands near the chamber midline; the "boundary district" is
	// contrived).  Force the boundary seat to ±TIEBREAK_EPS — one map with
	// D taking it, one with R — and run half the sims on each.  Anywhere
	// else, the base distribution still puts a real district at the
	// boundary, so we just use the natural pool for every sim.
	const TIEBREAK_EPS = 0.05;
	const fullyGerried = p.rGerry >= 0.5 && p.dGerry >= 0.5;
	let poolD, poolR;
	if (fullyGerried) {
		poolD = districtPool.slice();
		poolR = districtPool.slice();
		poolD[m] = -TIEBREAK_EPS; // D takes the boundary seat
		poolR[m] =  TIEBREAK_EPS; // R takes the boundary seat
	} else {
		poolD = districtPool;
		poolR = districtPool;
	}
	// medianDistParts records the boundary lean each sim actually used so
	// the displayed "median district partisanship" averages both variants
	// when the tiebreak is active; otherwise it's just the single value.
	const medianDistParts = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		medianDistParts[i] = (i & 1) === 0 ? poolD[m] : poolR[m];
	}

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

	// Optional per-district margin tracker (z-score histogram by winner).
	let marginTracker = null;
	let marginBins = null;
	if (marginBinSpec) {
		const { binSize, lo, hi } = marginBinSpec;
		const nBins = Math.max(1, Math.round((hi - lo) / binSize));
		const dCounts = new Float64Array(nBins);
		const rCounts = new Float64Array(nBins);
		marginTracker = { dCounts, rCounts, lo, binSize, nBins };
		const centres = new Array(nBins);
		const ranges = new Array(nBins);
		for (let i = 0; i < nBins; i++) {
			const a = lo + i * binSize;
			const b = a + binSize;
			centres[i] = (a + b) / 2;
			ranges[i] = [a, b];
		}
		marginBins = { dCounts, rCounts, centres, ranges, binSize, nBins };
	}

	for (let s = 0; s < n; s++) {
		// Even sims use the D-tiebreak pool, odd sims the R-tiebreak pool.
		const pool = (s & 1) === 0 ? poolD : poolR;
		const out = simulateOne(
			p,
			false,
			pool,
			mismatchTracker,
			electedTracker,
			marginTracker
		);
		meds[s] = out.medianIdeology;
		p33s[s] = out.p33Ideology;
		p67s[s] = out.p67Ideology;
		dMeds[s] = out.dMedianIdeology;
		rMeds[s] = out.rMedianIdeology;
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

	// Same normalisation for the per-district margin bins so the chart can
	// plot avg per-chamber counts instead of cumulative.
	if (marginBins) {
		const nB = marginBins.nBins;
		const avgD = new Array(nB);
		const avgR = new Array(nB);
		for (let i = 0; i < nB; i++) {
			avgD[i] = marginBins.dCounts[i] / n;
			avgR[i] = marginBins.rCounts[i] / n;
		}
		marginBins.avgD = avgD;
		marginBins.avgR = avgR;
		marginBins.nSims = n;
	}

	return {
		meds,
		p33s,
		p67s,
		dMeds,
		rMeds,
		parties,
		seats,
		mismatches,
		districtPool,
		medianDistParts,
		mismatchBins,
		electedBins,
		marginBins,
	};
}
