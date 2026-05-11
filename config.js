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
		// Each slider is capped at 0.5 so the two together can saturate the
		// chamber completely (rGerry = dGerry = 0.5 → no base contribution).
		// In the UI, these two sliders are pinned together by default — drag
		// either to scale gerrymandering on both sides equally; uncheck the
		// pin to make one party gerrymander more than the other.
		// At the full-saturation limit the boundary district has no natural
		// home, so runSimulations runs half its sims with the boundary seat
		// nudged toward D and half toward R; otherwise the tiebreak is off.
		// `gerry` is shared by both rGerry and dGerry sliders — edit once.
		gerry: { min: 0, max: 0.49, step: 0.01, value: 0.16 },

		// Intentional moderation is split into three sliders per party,
		// one per district type.  Labels use district COLOUR (blue / red);
		// the underlying mechanics are per-party (same-party-safe vs
		// opposite-party-safe) so the pin pairs stay by party.
		//   intModSafe:  same-party-safe moderation (uniform shape across
		//                all districts).  For D this is "in blue districts",
		//                for R "in red".
		//   intModSwing: swing-zone moderation (bell shape around the
		//                median).
		//   intModOpp:   opposite-party-safe moderation (saturating ramp
		//                into the other party's territory).  For D this
		//                is "in red districts", for R "in blue".
		intModSafe: { max: 3, step: 0.05, value: 1 },
		intModSwing: { max: 3, step: 0.05, value: 1 },
		intModOpp: { max: 3, step: 0.05, value: 1 },

		// How heavily voters punish ideologically extreme candidates relative
		// to district partisanship.
		qualImp: { min: 0, max: 0.9, step: 0.05, value: 0.3 },

		// Election noise σ — scales an additive unit-variance noise term that
		// gets added to the score (di − wMod·(cD+cR)) before the hard cutoff
		// at z = 0.  Larger values smear the cutoff out; 0 makes the election
		// fully deterministic given the candidate draws.
		sigmaN: { min: 0, max: 4, step: 0.1, value: 1 },
	},

	// ---------------- SIMULATION CONSTANTS -------------------------------------
	constants: {
		m: 217, // half-chamber size — total districts = 2*m + 1 = 435
		nsim: 1000, // simulations per render
		sigmaN: 2, // fallback election noise σ if the slider is missing
		// Election-noise SHAPE.  The actual noise σ comes from the sigmaN
		// slider; this just picks the unit-variance distribution that gets
		// scaled by it.
		noiseType: "bates",
		// Bates: continuous-N average of Uniform(−1, +1) draws, normalised to
		// unit variance.  Bounded, bell-shaped, fast.
		//   N = 1  → Uniform(−√3, +√3)               (flattest)
		//   N = 2  → triangular
		//   N = 3  → ≈ Gaussian-on-bounded-support
		//   N → ∞  → Gaussian
		bates: { N: 3 },
		// Tukey lambda: single shape parameter controls the whole family.
		//   λ = 0     → logistic (heavier than Gaussian)
		//   λ ≈ 0.14  → ≈ Gaussian
		//   λ = 0.5   → bounded, sub-Gaussian
		//   λ = 1     → Uniform(−1, +1)
		// NOT normalised — the raw draw is multiplied by sigmaN as-is, so
		// switching to tukey changes the effective noise σ.
		tukey: { lambda: 0.14 },
	},

	// ---------------- CANDIDATE BASE MAGNITUDE ---------------------------------
	// Before any moderation, candidate ideology is a point mass at ±magnitude
	// (D at −magnitude, R at +magnitude).  All spread comes from
	// intentionalMod.{safe,swing,opp}.var; all Laplace-tail from .tail.
	// At intMod sliders = 0 the chamber is fully deterministic at ±100.
	candidateMagnitude: 100,

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
			{ mean: 22, sigma: 7, weight: 1 }, // packed safe-R bump
		],
		componentsD: [
			{ mean: -22, sigma: 7, weight: 1 }, // packed safe-D bump (mirror)
		],
	},

	// ---------------- INTENTIONAL MODERATION -----------------------------------
	// Three sliders per party (safe / swing / opp); each one symmetrically
	// produces all three moderation effects.  Inside each slider-block the
	// three quantities are added DIRECTLY (no amplitudes, no slopes — the
	// slider scales them linearly from 0 at slider=0 to the configured
	// value at slider=default, with no upper clamp):
	//   - mean: added to the candidate-ideology mean (pulls cD up toward
	//     0, cR down toward 0).
	//   - var:  added to the Gaussian-core σ of cD / cR.
	//   - tail: added to the Laplace-tail scale of cD / cR.
	// Each one is multiplied by the slider's SHAPE function in d_i:
	//   - safe:  shape ≡ 1 (uniform across all districts).
	//   - swing: shape = bell(d_i − swingOffsetX, swingBreadth),
	//            a Gaussian bell at medianLean ± swingOffset.  swingOffset = 0
	//            puts it at the median; positive K shifts it toward the
	//            OPPOSITE party's side ("D moderates hardest reaching into R
	//            territory" / vice versa).
	//   - opp:   shape = min(stretch / oppSaturation, 1), a saturating linear
	//            ramp where stretch is how far d_i sits on the OTHER party's
	//            side of the median.
	// Each amp is anchored-linear in its slider:
	//   amp(slider) = amp + ampSlope · (slider − sliderDefault)
	// floored at 0 in readParams so slider-min positions disable the effect.
	intentionalMod: {
		// Where intMod sees the district: blend of d_i and d_i + v.
		// 0 ignores the wave (intMod anchored on raw district lean),
		// 1 treats it as fully wave-adjusted.
		waveWeight: 0,
		// Swing bell geometry (shared by mean / var / tail effects).
		swingOffset: 0, // K — bell peak distance from medianLean
		swingBreadth: 6, // bell half-decay distance (% points)
		// Opp ramp saturation: stretch distance (% points) at which the
		// linear "deeper-into-opp-territory" effect plateaus.
		oppSaturation: 20,
		// Per-block added quantities AT slider = default (slider value 1).
		// Effective value scales linearly with slider position from the
		// slider's [0, max] range:
		//     effective = configValue · (slider / sliderDefault)
		// e.g. at slider=0 the effective is 0; at slider=default it equals
		// the configured value; at slider=3·default it's 3× the configured
		// value.  Inside each block:
		//   mean — added directly to the candidate-ideology mean (pulls
		//     cD up toward 0, cR down toward 0).
		//   var  — added directly to the Gaussian-core σ of cD / cR.
		//   tail — added directly to the Laplace-tail scale of cD / cR.
		// The block's shape function in d_i then multiplies each of these.
		safe:  { mean: 0, var: 0, tail: 1 },
		swing: { mean: 6, var: 6, tail: 0 },
		opp:   { mean: 2, var: 0, tail: 6 },
	},

	// ---------------- HISTOGRAMS -----------------------------------------------
	histograms: {
		// Median-rep ideology histogram (top chart): the x-axis is fixed to
		// `defaultRange`, but extends outward to the next multiple of
		// `roundTo` if the data's tail percentile (`extendPercentile`) falls
		// outside the default bound.  The chart always shows `nBins` bins
		// across the chosen range, so per-bin width = (range) / nBins.
		median: {
			defaultRange: [-150, 150],
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
			binSize: 5,
			lo: -150,
			hi: 150,
		},
	},

	// ---------------- "SEE MORE PLOTS" SECTION ---------------------------------
	morePlots: {
		nChambers: 20, // example chambers in the grid
	},

	// ---------------- PRESETS --------------------------------------------------
	// Named bundles of slider values — rendered as buttons under the Reset
	// button.  Clicking applies all listed values, leaves any unlisted slider
	// at its current setting, and re-runs the simulator.
	// Preset values are raw slider positions; they need to lie in each
	// slider's auto-derived [min, max] range or the browser will clamp
	// them silently.  Each intMod slider's min is the largest zero-
	// crossing across its three blocks (mean / var / tail); max is
	// `default + slider.max`.  Asymmetric values automatically uncheck
	// the relevant pin checkbox.
	presets: {
		"Approximate 2024 Election": {
			v: 1.5, // R+1.5% national popular-vote margin
			rGerry: 0.19,
			dGerry: 0.15,
			// Modest D-edge in intentional moderation (Slotkin, Gallego, etc.
			// ran more aggressively moderate than their R counterparts).
			// Each party's intMod is split into three sliders: same-party
			// safe pull, swing-zone pull, and opposite-party tail growth.
			dIntModSafe: 2.0,
			rIntModSafe: 0.1,
			dIntModSwing: 2.0,
			rIntModSwing: 0.1,
			dIntModOpp: 2.0,
			rIntModOpp: 0.1,
			qualImp: 0.3,
		},
		// Demo of the gerry → less-extreme-median effect.
		// With ambMod maxed out (very wide candidate spreads), a small
		// popular-vote tilt (v = +3% R) and gerry = 0, R sweeps the swing
		// seats and wins ~234 — the chamber median sits ~17 deep into the
		// R pool at ideology +37.  As gerry rises to 0.49, the swing seats
		// vanish, R's seat count falls back to ~219 (razor-thin), and the
		// median collapses to R's most-moderate winner near +15.  R stays
		// the majority throughout (~90%+ of sims) and the median rep stays
		// cleanly on the R side of 0.
		// Hidden by default — flip `enabled` to true to show the button.
		"Gerry-compresses-median demo": {
			enabled: false,
			v: 3,
			rGerry: 0,
			dGerry: 0,
			// All intMod sliders at the auto-derived min (0) so all
			// intentional moderation is OFF.  qualImp at 0 — voters don't
			// punish extreme candidates.  Isolates the pure
			// "gerry shrinks majority size" mechanism.
			dIntModSafe: 0,
			rIntModSafe: 0,
			dIntModSwing: 0,
			rIntModSwing: 0,
			dIntModOpp: 0,
			rIntModOpp: 0,
			qualImp: 0,
			sigmaN: 5,
		},
	},
};
