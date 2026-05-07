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
		districtCompet: { min: 8, max: 30, step: 1, value: 19 },

		// Ambient candidate moderation: σ of the candidate-ideology distribution.
		// Used directly as σ in the simulator; also drives μ through `candidateMean`.
		dAmbMod: { min: 2, max: 8, step: 0.25, value: 5 },
		rAmbMod: { min: 2, max: 8, step: 0.25, value: 5 },

		// Intentional moderation: how strongly candidates moderate toward the
		// district median.  Asymmetric range — only nonneg values modelled.
		dIntMod: { min: 0, max: 4, step: 0.05, value: 2 },
		rIntMod: { min: 0, max: 4, step: 0.05, value: 2 },

		// How heavily voters punish ideologically extreme candidates relative
		// to district partisanship.
		qualImp: { min: 0, max: 1.2, step: 0.01, value: 0.6 },
	},

	// ---------------- SIMULATION CONSTANTS -------------------------------------
	constants: {
		m: 217, // half-chamber size — total districts = 2*m + 1 = 435
		nsim: 1000, // simulations per render
		muDist: 30, // mean of district-partisanship distribution (right half)
		sigmaN: 4, // election noise σ
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
		D: { defaultMu: -50, slope: 1 },
		R: { defaultMu: 50, slope: -1 },
	},

	// ---------------- HISTOGRAMS -----------------------------------------------
	histograms: {
		// Median-rep ideology histogram (top chart): the x-axis is fixed to
		// `defaultRange`, but extends outward to the next multiple of
		// `roundTo` if the data's 1st/99th percentile falls outside the
		// default bound.  The chart always shows 40 bins across the chosen
		// range, so per-bin width = (range) / 40.
		median: {
			defaultRange: [-50, 50],
			roundTo: 10,
		},
		// District-partisanship histogram (bottom chart): bin width in
		// percentage points across the fixed [-100%, 100%] range.
		district: {
			binSize: 2.5,
		},
	},
};
