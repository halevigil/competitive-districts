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
		v: { min: -15, max: 15, step: 0.5, value: 0 },

		// Proportion of gerrymandered seats (α ∈ [0, 1]).  At α = 0 the chamber
		// is drawn from a single broad Gaussian centred on 0 (≈ historical
		// shape).  At α = 1 every district comes from the gerrymandered
		// distribution (see `districtGerry` below).  The pool is the
		// α-weighted mixture: (1 − α) · base + α · gerry.
		districtCompet: { min: 0, max: 1, step: 0.05, value: 0.5 },

		// Ambient candidate moderation: σ of the candidate-ideology distribution.
		// Used directly as σ in the simulator; also drives μ through `candidateMean`.
		dAmbMod: { min: 0, max: 4, step: 0.1, value: 2 },
		rAmbMod: { min: 0, max: 4, step: 0.1, value: 2 },

		// Intentional moderation: how strongly candidates moderate toward the
		// district median.  Asymmetric range — only nonneg values modelled.
		dIntMod: { min: 0, max: 12, step: 0.1, value: 6 },
		rIntMod: { min: 0, max: 12, step: 0.1, value: 6 },

		// How heavily voters punish ideologically extreme candidates relative
		// to district partisanship.
		qualImp: { min: 0, max: 1.4, step: 0.01, value: 0.7 },
	},

	// ---------------- SIMULATION CONSTANTS -------------------------------------
	constants: {
		m: 217, // half-chamber size — total districts = 2*m + 1 = 435
		nsim: 1000, // simulations per render
		sigmaN: 2, // election noise σ
		// Additive epsilon (in % points) added inside the log term so the
		// candidate-position drive stays finite at |partisanship| → 0.
		//   logInvD = log(100 / (|d| + epsPct))
		epsPct: 1,
		// Election-uncertainty noise added to z (the hard-cutoff input).
		// `noiseType` picks which distribution to draw from: 'bates' or 'tukey'.
		// Both blocks live alongside each other so you can flip between them
		// without losing your tuned parameters.
		noiseType: "tukey",
		// Bates: continuous-N average of Uniform(−1, +1) draws, normalised to
		// unit variance.  Bounded, bell-shaped, fast.
		//   N = 1  → Uniform(−√3, +√3)               (flattest)
		//   N = 2  → triangular
		//   N = 3  → ≈ Gaussian-on-bounded-support
		//   N → ∞  → Gaussian
		// `weight` is the noise σ directly.  Set weight = 0 to disable.
		bates: {
			weight: 3,
			N: 2.5,
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
		D: { defaultMu: -30, slope: 2 },
		R: { defaultMu: 30, slope: -2 },
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
		enforceSymmetry: true,
		components: [{ mean: 5, sigma: 30, weight: 1 }],
	},
	// `gerry` is the same base modified two ways:
	//   1. Samples in `removeRange` are rejected (so a band of competitive
	//      seats vanishes).
	//   2. A new Gaussian (`bumpCenter`, `bumpSigma`) is added — the packed
	//      "safe-R" districts created by gerrymandering.  Its weight relative
	//      to the truncated-base part within `gerry` is `bumpWeight`.
	districtGerry: {
		removeRange: [0, 10],
		bumpCenter: 20,
		bumpSigma: 7,
		bumpWeight: 0.5,
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
	//                 cD adds +meanAmp * bD * bell(d, +K, meanBreadth)
	//                 cR adds −meanAmp * bR * bell(d, −K, meanBreadth)
	//                 σ_D_eff(d) = σ_D + varAmp * bDs * varModRatio * bell(d, +L, varBreadth)
	//                 σ_R_eff(d) = σ_R + varAmp * bRs * varModRatio * bell(d, −L, varBreadth)
	// Tuned to roughly match the 2020 mismatch distribution
	// (8 / 5 / 3 / 0 / 0 across magnitude bins 0-5/5-10/10-15/15-20/20+, ~16 total).
	intentionalMod: {
		mode: "offsetK",
		K: 3,
		L: 12,
		meanAmp: 0.5, // overall scale on the mean-moderation pull
		varAmp: 1, // overall scale on the variance bump
		meanBreadth: 10, // mean-bell half-decay distance in % points
		varBreadth: 10, // variance-bell half-decay distance in % points
		// Relative sensitivity of the variance bump to the dIntMod / rIntMod
		// slider, vs. the mean-moderation pull (which scales 1:1 with bD/bR).
		//   varModRatio = 1: variance scales with the slider 1:1 (matches mean).
		//   varModRatio = 0: variance bump is killed — slider has no effect on σ.
		//   varModRatio > 1: slider has more leverage on σ than on the mean.
		varModRatio: 1.0,
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
			binSize: 4,
		},
	},

	// ---------------- "SEE MORE PLOTS" SECTION ---------------------------------
	morePlots: {
		nChambers: 20, // example chambers in the grid
		nSimsForMismatch: 500, // simulations averaged for the mismatch chart
	},
};
