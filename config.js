// =============================================================================
// MODEL CONFIG
// -----------------------------------------------------------------------------
// Single source of truth for slider ranges, simulation constants, and the
// candidate-ideology coupling.  Edit the numbers here; index.html reads this
// at load time and applies it to the sliders and the simulation.
//
// Convention: each slider's `value` (default) sits at the midpoint of
// [min, max] so the center indicator on the slider track visually marks
// the default.  Keeping that convention is recommended but not enforced.
// =============================================================================
window.CONFIG = {
	// ---------------- SLIDERS --------------------------------------------------
	// Standard HTML range-input attributes for each user-facing knob.
	sliders: {
		// Popular Vote (Republican wave +, Democratic wave -)
		v: { min: -10, max: 10, step: 0.5, value: 0 },

		// Per-party gerrymandering weights — absolute mass each party's packed
		// component contributes to the chamber pool.  Pool density is
		//   (1 − rGerry − dGerry) · base  +  rGerry · gerry.componentsR
		//                                  +  dGerry · gerry.componentsD
		// so dragging one slider up reduces the base ("competitive") share.
		// Each slider is capped at 0.5 so the two together can saturate to a
		// fully gerrymandered chamber (50% R-packed + 50% D-packed, no base).
		// In the UI, these two sliders are pinned together by default — drag
		// either to scale gerrymandering on both sides equally; uncheck the
		// pin to make one party gerrymander more than the other.
		rGerry: { min: 0, max: 0.3, step: 0.01, value: 0.15 },
		dGerry: { min: 0, max: 0.3, step: 0.01, value: 0.15 },

		// Ambient candidate moderation: σ of the candidate-ideology distribution.
		// Used directly as σ in the simulator; also drives μ through
		// `candidateMean`.  Pinned together in the UI by default.
		dAmbMod: { min: 0, max: 15, step: 0.1, value: 7.5 },
		rAmbMod: { min: 0, max: 15, step: 0.1, value: 7.5 },

		// Intentional moderation: how strongly candidates moderate toward the
		// district median.  Pinned together in the UI by default.  Sensitivities
		// in `intentionalMod` below are picked so the lowest slider position
		// (0) drives BOTH meanAmp and varAmp to exactly 0 — i.e. zero
		// intentional moderation when the slider is fully left.
		dIntMod: { min: 0, max: 9, step: 0.05, value: 1.5 },
		rIntMod: { min: 0, max: 9, step: 0.05, value: 1.5 },

		// How heavily voters punish ideologically extreme candidates relative
		// to district partisanship.
		qualImp: { min: 0, max: 0.5, step: 0.05, value: 0.25 },
	},

	// ---------------- SIMULATION CONSTANTS -------------------------------------
	constants: {
		m: 217, // half-chamber size — total districts = 2*m + 1 = 435
		nsim: 1000, // simulations per render
		sigmaN: 2, // election noise σ
		noiseType: "tukey",
		// Bates: continuous-N average of Uniform(−1, +1) draws, normalised to
		// unit variance.  Bounded, bell-shaped, fast.
		//   N = 1  → Uniform(−√3, +√3)               (flattest)
		//   N = 2  → triangular
		//   N = 3  → ≈ Gaussian-on-bounded-support
		//   N → ∞  → Gaussian
		// `weight` is the noise σ directly.  Set weight = 0 to disable.
		bates: {
			weight: 2,
			N: 3,
		},
		// Tukey lambda: single shape parameter controls the whole family.
		//   λ = 0     → logistic (heavier than Gaussian)
		//   λ ≈ 0.14  → ≈ Gaussian
		//   λ = 0.5   → bounded, sub-Gaussian
		//   λ = 1     → Uniform(−1, +1)
		// NOT normalised to unit variance — `weight` is an outer multiplier
		// on the raw draw, tune to taste.
		tukey: {
			weight: 1,
			lambda: 0.14,
		},
	},

	// ---------------- CANDIDATE-IDEOLOGY MEAN COUPLING -------------------------
	// For each party, the candidate-ideology mean μ is anchored at `defaultMu`
	// when the ambient-moderation slider is at its default position, and
	// moves with `slope` per unit of σ away from that default:
	//     μ = defaultMu + slope * (σ - σ_default)
	//
	// This lets you change the slider's default σ and the default μ
	// independently — at slider=default, μ = defaultMu regardless of σ_default.
	candidateMean: {
		D: { defaultMu: -100, slope: 2 },
		R: { defaultMu: 100, slope: -2 },
	},

	// ---------------- DISTRICT DISTRIBUTION ------------------------------------
	// The 435 district partisanships are drawn from an α-mixture:
	//     (1 − α) · base  +  α · gerry
	// where α is the `districtCompet` slider's value ("proportion of
	// gerrymandered seats").  The model samples K=50,000 points from this
	// mixture and takes 435 evenly-spaced quantiles to give a deterministic
	// pool (re-cached per (α, base, gerry) tuple).
	//
	// `base` is an arbitrary mixture of Gaussian components.  Each component
	// has a `mean`, `sigma`, and `weight` (weights are renormalised, so they
	// don't have to sum to 1).
	//
	// `enforceSymmetry: true` samples m points from the right half (rejects
	// any negatives and >100), sorts them, and mirrors to the left so the
	// full distribution is exactly symmetric (mean = 0 by construction).
	// `enforceSymmetry: false` samples 2m+1 points directly from the mixture
	// across [−100, 100], rejecting only out-of-range samples — the pool
	// can be skewed if the components are.
	districtBase: {
		// `enforceSymmetry: true` only affects the BASE portion of the pool
		// (the (1−α)·N draws): they're sampled from the right half and then
		// mirrored to the left, so the base contribution is exactly symmetric
		// about 0.  The gerry portion is always sampled directly across
		// [-100, 100] regardless of this flag — gerry can be skewed by
		// `gerryAdv`, which is the whole point.
		enforceSymmetry: true,
		components: [{ mean: 0, sigma: 30, weight: 1 }],
	},
	// `gerry` packs two separate component lists — one per party — and the
	// `gerryAdv` slider blends between them.  Both lists obey the shared
	// `removeRange`: any sample landing in that band is rejected, so the gerry
	// distribution has zero density there (the "vanished competitive seats").
	//
	//   weight_R = 0.5 · (1 + gerryAdv)   ← share of gerry samples drawn from componentsR
	//   weight_D = 0.5 · (1 − gerryAdv)   ← share drawn from componentsD
	//
	// Component shape: `{ mean, sigma, weight }`, same as districtBase.
	// The within-list weights are renormalised, so the user only needs to
	// keep relative weights consistent within each party's list.
	districtGerry: {
		removeRange: [-10, 10],
		componentsR: [
			{ mean: 20, sigma: 7, weight: 1 }, // packed safe-R bump
		],
		componentsD: [
			{ mean: -20, sigma: 7, weight: 1 }, // packed safe-D bump (mirror)
		],
	},

	// ---------------- INTENTIONAL-MODERATION SHAPE -----------------------------
	// The intentional-moderation reward and the variance-bump term each use a
	// Gaussian "bell" shape centred on a district-partisanship offset:
	//     bell(d, off, w) = exp( -(d - off)^2 / w^2 )
	// `w` is the Gaussian's half-decay distance — at |d - off| = w the bell
	// drops to e⁻¹ ≈ 0.37 (it's the bell's σ).  Larger w → broader peak.
	// The mean-moderation and variance-bump bells get their own widths
	// (`meanBreadth`, `varBreadth`) so the two effects can be tuned
	// independently — e.g. a sharp mean pull near d = K combined with a
	// broader heterogeneity bump out at d = L.
	//
	//   'centered': peaks at d = 0 (50/50 district).  Original behaviour —
	//               candidates moderate most when their district is balanced.
	//               Variance bump disabled.
	//
	//   'offsetK':  Mean-position peak at d = ±K toward the other party
	//               (Democrats: +K, Republicans: -K).  Captures the intuition
	//               that a party tries hardest to moderate when stretching to
	//               win territory that leans the other way.
	//
	//               Plus a candidate-σ bump at d = ±L (typically L > K) of
	//               amplitude `varAmp`.  Models heterogeneity in deeper
	//               stretch territory: some try harder, some give up.
	// `meanAmp` and `varAmp` are now ANCHORED at the slider default — like
	// `candidateMean.defaultMu`, they specify the value AT slider default, and
	// each slope (`meanSensitivity` / `varSensitivity`) controls how the
	// effective amplitude shifts as the slider moves away from default:
	//     ampD    = meanAmp + meanSensitivity * (bD - bD_default)
	//     ampR    = meanAmp + meanSensitivity * (bR - bR_default)
	//     varAmpD = varAmp  + varSensitivity  * (bD - bD_default)
	//     varAmpR = varAmp  + varSensitivity  * (bR - bR_default)
	// The simulator then uses ampD / ampR / varAmpD / varAmpR DIRECTLY:
	//     cD adds +ampD · bell(d, +K, meanBreadth)
	//     cR adds −ampR · bell(d, −K, meanBreadth)
	//     σ_D_eff(d) = σ_D + varAmpD · bell(d, +L, varBreadth)
	//     σ_R_eff(d) = σ_R + varAmpR · bell(d, −L, varBreadth)
	// (`varAmp` adds to σ — i.e. one standard deviation — directly; no extra
	// slider / ratio factors, they're folded into the sensitivities.)
	// Tuned to roughly match the 2020 mismatch distribution
	// (8 / 5 / 3 / 0 / 0 across magnitude bins 0-5/5-10/10-15/15-20/20+, ~16 total).
	intentionalMod: {
		mode: "offsetK",
		K: 3,
		L: 12,
		meanAmp: 1.5, // mean-moderation pull AT slider default
		varAmp: 9, // candidate-σ bump amplitude AT slider default
		// Sensitivities = amp / slider_default, so at slider = 0 both
		// amplitudes drop to 0 and the slider's lowest setting fully turns
		// off intentional moderation.
		meanSensitivity: 2, // = meanAmp / dIntMod_default = 1.5 / 1.5
		varSensitivity: 6, // = varAmp  / dIntMod_default = 9   / 1.5
		meanBreadth: 8, // mean-bell half-decay distance in % points
		varBreadth: 8, // σ-bell half-decay distance in % points
	},

	// ---------------- HISTOGRAMS -----------------------------------------------
	histograms: {
		// Median-rep ideology histogram (top chart): the x-axis is fixed to
		// `defaultRange`, but extends outward to the next multiple of
		// `roundTo` if the data's tail percentile (`extendPercentile`) falls
		// outside the default bound.  The chart always shows `nBins` bins
		// across the chosen range, so per-bin width = (range) / nBins.
		median: {
			defaultRange: [-50, 50],
			roundTo: 10,
			nBins: 40,
			extendPercentile: 0.01, // 1st / 99th percentile
		},
		// District-partisanship histogram (bottom chart): bin width in
		// percentage points across the fixed [-100%, 100%] range.
		district: {
			binSize: 2,
		},
		// Per-party rep-ideology histograms (in "see more plots"):
		// bin width and x-axis range, in ideology units (% points).  The
		// see-more-plots panel renders one chart per party using these
		// settings, and the example-chamber scatter chart's y-axis range
		// is also taken from `[lo, hi]` so the two views line up.
		repIdeology: {
			binSize: 3,
			lo: -150,
			hi: 150,
		},
	},

	// ---------------- "SEE MORE PLOTS" SECTION ---------------------------------
	morePlots: {
		nChambers: 20, // example chambers in the grid
		nSimsForMismatch: 500, // simulations averaged for the mismatch chart
	},
};
