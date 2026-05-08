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

		// District map: σ of the district-partisanship distribution.
		// Higher → more swing districts, fewer safe ones.
		districtCompet: { min: 13, max: 33, step: 1, value: 23 },

		// Ambient candidate moderation: σ of the candidate-ideology distribution.
		// Used directly as σ in the simulator; also drives μ through `candidateMean`.
		dAmbMod: { min: 1, max: 4, step: 0.25, value: 2 },
		rAmbMod: { min: 1, max: 4, step: 0.25, value: 2 },

		// Intentional moderation: how strongly candidates moderate toward the
		// district median.  Asymmetric range — only nonneg values modelled.
		dIntMod: { min: 2, max: 10, step: 0.05, value: 4 },
		rIntMod: { min: 2, max: 10, step: 0.05, value: 4 },

		// How heavily voters punish ideologically extreme candidates relative
		// to district partisanship.
		qualImp: { min: 0, max: 1.5, step: 0.01, value: 1 },
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
		// Continuous-N Bates draw — sum of N Uniform(−1, +1) samples,
		// normalised to unit variance, with fractional N achieved by adding
		// one extra uniform with probability frac(N).  Bounded, bell-shaped,
		// and very fast (N+1 calls to Math.random()).
		//   N = 1  → Uniform(−√3, +√3)               (flattest)
		//   N = 2  → triangular
		//   N = 3  → ≈ Gaussian-on-bounded-support
		//   N → ∞  → Gaussian
		// `weight` is an outer multiplier on the unit-variance draw, so it is
		// the noise σ directly.  Set weight = 0 to disable.
		bates: {
			weight: 3,
			N: 2.5,
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
		D: { defaultMu: -30, slope: 1 },
		R: { defaultMu: 30, slope: -1 },
	},

	// ---------------- DISTRICT-PARTISANSHIP MEAN COUPLING ----------------------
	// Same idea for the district-partisanship distribution: as the
	// districtCompet slider's σ moves away from its default, the mean
	// partisanship of the right-half distribution shifts with `slope` per
	// unit of σ.  Negative slope = "more competitive map → mean partisanship
	// pulls toward 0".
	//     muDist = defaultMu + slope * (σ - σ_default)
	districtMean: {
		defaultMu: 30,
		slope: -1,
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
		L: 15,
		meanAmp: 0.3, // overall scale on the mean-moderation pull
		varAmp: 1.2, // overall scale on the variance bump
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
			binSize: 5,
		},
	},

	// ---------------- "SEE MORE PLOTS" SECTION ---------------------------------
	morePlots: {
		nChambers: 20, // example chambers in the grid
		nSimsForMismatch: 500, // simulations averaged for the mismatch chart
	},
};
