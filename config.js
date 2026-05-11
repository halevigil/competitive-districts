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
		// the underlying mechanics are still per-party (same-party-safe vs
		// opposite-party-safe) so the pin pairs stay by party.
		//   intModSafe:  same-party-safe pull (drives safeAmp).
		//                For D this is "in blue districts", for R "in red".
		//   intModSwing: swing-zone moderation (drives meanAmp, varAmp,
		//                bell widths).
		//   intModOpp:   opposite-party-safe tail growth (drives
		//                tailGrowth).  For D this is "in red districts",
		//                for R "in blue".
		intModSafe:  { max: 3, step: 0.05, value: 1 },
		intModSwing: { max: 3, step: 0.05, value: 1 },
		intModOpp:   { max: 3, step: 0.05, value: 1 },

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

	// ---------------- CANDIDATE-IDEOLOGY MEAN + SPREAD -------------------------
	// Per-party candidate ideology is N(mu, sigma) before any moderation
	// terms are added.  The ambient-moderation slider that used to drive
	// these has been removed; tune via this block instead.
	candidateMean: {
		D: { mu: -100, sigma: 6 },
		R: { mu:  100, sigma: 6 },
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
			{ mean: 22, sigma: 7, weight: 1 }, // packed safe-R bump
		],
		componentsD: [
			{ mean: -22, sigma: 7, weight: 1 }, // packed safe-D bump (mirror)
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
	// `meanAmp` and `varAmp` are the per-party amplitudes AT the slider
	// default (set in CONFIG.sliders.intMod.value).  `meanAmpSlope` and
	// `varAmpSlope` are the slopes — how much each amp changes per slider
	// unit away from default.  index.html auto-derives the slider's min
	// (where amp = 0) and max (default + intMod.max slope units above):
	//     ampD    = meanAmp + meanAmpSlope · (bD - sliderDefault)
	//     ampR    = meanAmp + meanAmpSlope · (bR - sliderDefault)
	//     varAmpD = varAmp  + varAmpSlope  · (bD - sliderDefault)
	//     varAmpR = varAmp  + varAmpSlope  · (bR - sliderDefault)
	// And in the simulator:
	//     cD adds +ampD · bell(d, +K, meanBreadth)
	//     cR adds −ampR · bell(d, −K, meanBreadth)
	//     σ_D_eff(d) = σ_D + varAmpD · bell(d, +L, varBreadth)
	//     σ_R_eff(d) = σ_R + varAmpR · bell(d, −L, varBreadth)
	// (`varAmp` adds to σ — one standard deviation — directly.)
	intentionalMod: {
		mode: "offsetK",
		K: 0,
		L: 0,
		// How much of the popular-vote shift `v` feeds into where candidates
		// strategically moderate.  Bell centres land at d_i + waveWeight·v − modOffset,
		// so 0 ignores the wave entirely (intMod anchored on the district's own
		// lean), 1 treats moderation as fully wave-adjusted, and intermediate
		// values blend the two.  Applies to both the mean bell and the
		// variance-bump bell, and to the meanAmp-driven tail term.
		waveWeight: 0,
		meanAmp: 6, // mean-moderation pull AT slider default
		varAmp: 6, // candidate-σ bump amplitude AT slider default
		// Slopes are tied to `intMod.max` so the slider's auto-derived "amp = 0"
		// min sits the same distance below default as the slider max is above.
		// With max = 1: slope = meanAmp / max = 3, giving slider range [0, 2]
		// with default at 1 (midpoint), amp range [0, 6].
		meanAmpSlope: 9, // d(meanAmp) / d(slider)
		varAmpSlope: 9, // d(varAmp)  / d(slider)
		// Bell half-decay distances at slider default.  meanBreadthSlope /
		// varBreadthSlope let the bells widen as the intMod slider goes up
		// (parties moderate more aggressively AND across a wider swing
		// zone).  Set the slope to 0 to keep breadth fixed.
		meanBreadth: 6, // mean-bell half-decay distance at slider default
		varBreadth: 6, // σ-bell half-decay distance at slider default
		meanBreadthSlope: 0, // d(meanBreadth) / d(slider)
		varBreadthSlope: 0, // d(varBreadth)  / d(slider)
		// Candidate-ideology tail growth in stretch territory.  Adds a
		// Laplace-distributed component to cD / cR whose scale is 0 at
		// d_i = medianLean and grows linearly with stretch distance as d_i
		// moves toward the OTHER party's side, up to a configurable cap.
		// Captures "some try hard, some give up" heterogeneity in deep-
		// stretch districts.  Per-party scaling is driven by each party's
		// intMod slider via anchoredLinear, just like the other amps.
		tailGrowth: 0.3, // Laplace-scale growth per % stretch, at slider default
		tailGrowthSlope: 0.3, // d(tailGrowth) / d(slider)
		// Saturation: stretch distance (in % points) beyond which the linear
		// growth stops.  Effective stretch = min(actual stretch, saturation).
		// Set to Infinity to keep the original "grows forever" behaviour.
		tailGrowthSaturation: 20,
		// On top of the stretch-territory growth above, meanAmp also widens
		// the tail at its bell — wherever the moderation pull is strong, the
		// candidates also fan out more.  Per-party factor follows the same
		// anchored-linear pattern as meanAmp/meanAmpSlope:
		//     factor_X = meanAmpTailFactor + meanAmpTailFactorSlope · (bX − sliderDefault)
		// `meanAmpTailFactor` is the scale AT slider default;
		// `meanAmpTailFactorSlope` is how it changes with the intMod
		// slider.  Floored at 0 in readParams so we never get a negative
		// tail-factor; 0 across both knobs disables the contribution.
		meanAmpTailFactor: 0,
		meanAmpTailFactorSlope: 0,
		// Same-party safe-district pull toward the centre.  Models primary-
		// from-the-centre / "no reason to be too extreme even when safe"
		// pressure.  Pull grows linearly with how far d_i sits on the OWN
		// party's side of the median, capped at safeAmpSaturation:
		//   pullD = +safeAmp_D · min(medianLean − di, safeAmpSaturation)  (di < medianLean)
		//   pullR = −safeAmp_R · min(di − medianLean, safeAmpSaturation)  (di > medianLean)
		// safeAmp_X comes from anchoredLinear(intModSafe slider, default,
		// safeAmp, safeAmpSlope), floored at 0 in readParams.
		safeAmp: 0,
		safeAmpSlope: 0,
		safeAmpSaturation: 20,
	},

	// Always-on Laplace tail on candidate ideology, separate from intMod.
	// Adds a moderate-tail component to every candidate draw on top of the
	// Gaussian core, so chambers occasionally pull a clearly off-trend
	// candidate even in safe districts.  Set to 0 to recover pure-Gaussian
	// candidate ideologies.
	candidateTailScale: 0,

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
		nSimsForMismatch: 500, // simulations averaged for the mismatch chart
	},

	// ---------------- PRESETS --------------------------------------------------
	// Named bundles of slider values — rendered as buttons under the Reset
	// button.  Clicking applies all listed values, leaves any unlisted slider
	// at its current setting, and re-runs the simulator.
	// Preset slider values are MULTIPLIERS / direct slider values, not the
	// underlying model amplitudes — they need to lie in each slider's
	// [min, max] range or the browser will clamp them silently.  In
	// particular, dIntMod / rIntMod max out at 1 by default, so values
	// above 1 just snap to 1.
	// Preset slider values must lie in each slider's auto-derived
	// [min, max] range — for dIntMod / rIntMod that's
	// [intMod.value − meanAmp/meanAmpSlope, intMod.value + intMod.max].
	// Asymmetric values automatically uncheck the relevant pin checkbox.
	presets: {
		"Approximate 2024 Election": {
			v: 1.5, // R+1.5% national popular-vote margin
			rGerry: 0.19,
			dGerry: 0.15,
			// Modest D-edge in intentional moderation (Slotkin, Gallego, etc.
			// ran more aggressively moderate than their R counterparts).
			// Each party's intMod is split into three sliders: same-party
			// safe pull, swing-zone pull, and opposite-party tail growth.
			dIntModSafe:  2.0,
			rIntModSafe:  0.1,
			dIntModSwing: 2.0,
			rIntModSwing: 0.1,
			dIntModOpp:   2.0,
			rIntModOpp:   0.1,
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
			dIntModSafe:  0,
			rIntModSafe:  0,
			dIntModSwing: 0,
			rIntModSwing: 0,
			dIntModOpp:   0,
			rIntModOpp:   0,
			qualImp: 0,
			sigmaN: 5,
		},
	},
};
