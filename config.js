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
		v: { min: -10, max: 10, step: 0.1, value: 0 },

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
		gerry: { min: 0, max: 0.49, step: 0.001, value: 0.16 },

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

		// How heavily voters punish ideologically extreme candidates
		// relative to district partisan lean.  Stored as sqrt(wMod) so
		// the slider's perceptual scale is linear while the underlying
		// coefficient grows quadratically — same convention as
		// sqrtSigmaN / sigmaN.  readParams squares it to feed `wMod`
		// to the model.  Default sqrtQualImp = √0.2 ≈ 0.447 reproduces
		// the old wMod = 0.2 default; max √1.0 = 1 covers the old
		// wMod range up to 1.0 (so existing ranges still reach).
		sqrtQualImp: { min: 0, max: 1, step: 0.01, value: 0.45 },

		// Election noise sqrt(σ) — squaren scales an additive unit-variance noise term that
		// gets added to the score (di − wMod·(cD+cR)) before the hard cutoff
		// at z = 0.  Larger values smear the cutoff out; 0 makes the election
		// fully deterministic given the candidate draws.
		sqrtSigmaN: { min: 0, max: 1.5, step: 0.1, value: 0.5 },

		// Incumbency advantage (historical.html only — the simulator
		// page has no notion of "previous winner" so the slider isn't
		// rendered there and the value defaults to 0).  Slider value
		// is the MEAN per-district shift (in pp) applied to the
		// predicted election score z in favour of the incumbent's
		// party: +incumbency for R-held seats, −incumbency for D-held
		// seats, 0 for open seats / unknown.  The "incumbent" is
		// whoever won the same district in the previous cycle
		// (matched on state+district string; redistricting boundary
		// changes are approximated, not modelled).
		// See `incumbencyMod` below for per-district variance + tail.
		incumbency: { min: 0, max: 10, step: 0.25, value: 3 },
	},

	// ---------------- INCUMBENCY (mean / var / tail, historical.html only) ----
	// Per-district per-sim shift applied to z in favour of the incumbent's
	// party (sign ∈ {−1, 0, +1}):
	//   shift_i = sign_i · (mean + var · randn() + tail · laplaceSample())
	// All three are scaled by the incumbency slider in the same way the
	// intentional-moderation blocks (safe / swing / opp) are scaled by
	// their sliders:
	//   effective = (slider / sliderDefault) · configValue
	// so slider = sliderDefault (3) → effective = configValue;
	// slider = 0 → all three zero (incumbency off entirely); slider =
	// 2·sliderDefault → all three doubled.
	//
	// `mean = 3` at the default keeps the slider's numeric value equal
	// to the effective mean shift in pp (slider=3 → mean=3pp,
	// slider=6 → mean=6pp), so the slider label "Incumbency Advantage
	// (pp)" still reads naturally; var and tail default to 0 so by
	// default the boost is deterministic per district.  Bump var to ~2
	// and tail to ~1 to capture realistic cycle-to-cycle variation in
	// incumbency advantage (scandals, retirement quality drops, etc.).
	incumbencyMod: {
		mean: 3,
		var: 1,
		tail: 0,
	},

	// ---------------- PVI WEIGHTING (historical.html only) ---------------------
	// Cook-style PVI is a weighted average of recent presidential margins
	// minus the same weighted national popular vote.  These weights set
	// how heavily the MOST RECENT presidential election counts vs the one
	// before it; both the per-district PVI and the national-vote
	// subtraction use the same ratio so districts stay national-relative.
	//   presYear.cur / prev    — used on presidential-year charts.
	//                            Default 4 / 1 (= 4:1 cur:prev) biases
	//                            toward the contest actually being
	//                            analysed; Cook uses 3:1.
	//   midterm.recent / prev  — used on midterm-year charts.
	//                            Default 2 / 1 matches Cook's classic
	//                            midterm PVI methodology.
	// Where the prior pres isn't available in the year's district lines
	// (1992 globally, 1994, 2002, 2022, etc.), the PVI collapses to
	// single-cycle (just the recent margin minus its national).
	// Edited values take effect on the next page load — historical.html
	// reads these on init and bakes them into yearStats.
	pviWeights: {
		presYear: { cur: 4, prev: 1 },
		midterm: { recent: 2, prev: 1 },
	},

	// ---------------- PER-YEAR SQRT-QUAL-IMP STARTING POINTS (auto-fit only) --
	// Auto-fit uses the sqrtQualImp slider's CURRENT value as its
	// starting point for golden-section.  When this map has an entry
	// for the selected year, auto-fit overrides the slider to the
	// listed value before optimisation kicks off — useful for years
	// where the optimiser otherwise gets stuck in a local minimum
	// (e.g. wave years where the effective wMod wants to be high vs
	// muted-cycle years where it wants to be low).  Slider value isn't
	// touched outside of auto-fit; manual drags still respect whatever
	// the user picked.  Years not listed: golden-section starts from
	// whatever the slider currently shows.
	// Values are sqrtQualImp (slider units), NOT wMod — multiply
	// the desired wMod's square root.  Slider runs 0–1, default 0.45
	// (= sqrt of the old wMod default 0.2).
	historicalSqrtQualImpByYear: {
		// Per-cycle baseline: starting from wMod = 0.20 in 2024 and
		// increasing by 0.05 each cycle going back (so 1992 caps at
		// wMod = 1.0).  Values stored as sqrtQualImp = √wMod since
		// that's what the slider holds.  Manually picked, not data-
		// driven — adjust freely as the historical fit gets refined.
		2024: 0.45, // wMod = 0.20
		2022: 0.5, // wMod = 0.25
		2020: 0.55, // wMod = 0.30
		2018: 0.59, // wMod = 0.35
		2016: 0.63, // wMod = 0.40
		2014: 0.67, // wMod = 0.45
		2012: 0.71, // wMod = 0.50
		2010: 0.74, // wMod = 0.55
		2008: 0.77, // wMod = 0.60
		2006: 0.81, // wMod = 0.65
		2004: 0.84, // wMod = 0.70
		2002: 0.87, // wMod = 0.75
		2000: 0.89, // wMod = 0.80
		1998: 0.92, // wMod = 0.85
		1996: 0.95, // wMod = 0.90
		1994: 0.97, // wMod = 0.95
		1992: 1.0, // wMod = 1.00 (slider max)
	},

	// ---------------- CALIBRATION DIAGNOSTICS (historical.html only) ----------
	// Three diagnostic charts can appear under the simulator-on-year row:
	//   1. Per-lean W² contribution (gray bars)
	//   2. PIT shape histogram (red/blue bars with auto-interpretation)
	//   3. PIT shape per lean band (2D heatmap)
	// These are developer-facing tuning aids; not useful for the public-
	// facing version of the page.  Hidden by default everywhere.  Flip
	// to true here to expose them locally; the runtime code ALSO hard-
	// hides them on any fly.dev / fly.io host so a stray `true` left in
	// config.js doesn't accidentally leak to the deployed site.
	showCalibrationPlots: false,

	// ---------------- SIMULATION CONSTANTS -------------------------------------
	constants: {
		m: 217, // half-chamber size — total districts = 2*m + 1 = 435
		// Simulations per render on the simulator page (index.html).  Larger
		// = smoother per-bin averages, slower per-drag re-render.  At
		// ~0.15 ms/sim, 500 sims ≈ 75 ms of pure compute per drag.
		nsim: 1000,
		// Same idea, but for the historical page (historical.html), which
		// runs the simulator twice per drag (once on the analytic pool for
		// the bottom row, once on the selected year's real district pool
		// for the middle row).  Defaulted lower than `nsim` so drags stay
		// snappy when there are two sims to do.
		historicalNsim: 1000,
		// Milliseconds to wait after the LAST slider-input event before
		// firing a fresh simulator render.  Larger = waits longer for the
		// drag to settle (fewer re-renders, less churn); smaller = updates
		// closer to real-time as you drag (more re-renders, more CPU).
		//   30  → feels close to "live" updates during drag
		//   80  → balanced (a brief pause triggers a render)
		//   150 → only updates when you stop moving
		// `sliderDebounceMs` controls the simulator page; the historical
		// page falls back to it if `historicalSliderDebounceMs` is unset,
		// otherwise uses its own value.  Either page can therefore be
		// tuned independently (or both together by setting only the
		// shared knob).
		sliderDebounceMs: 80,
		historicalSliderDebounceMs: 80,
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
	// The 435 district partisan leans are drawn from an α-mixture:
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
		components: [{ mean: 0, sigma: 25, weight: 1 }],
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
		// Bell half-decay distance (% points) at slider = default.
		// At slider = default the per-party effective breadth equals
		// `swingBreadth`, preserving the historical meaning of this knob.
		swingBreadth: 8,
		// How much the bell breadth changes per unit of slider above
		// default (additive, per party — slider on the L side widens the
		// L bell, R the R bell when the pin is unchecked).  Effective
		// breadth = swingBreadth + swingBreadthSlope · (slider/default − 1),
		// floored at 0.5 to keep the bell from collapsing.  Larger values
		// make the swing slider do more work per click — auto-fit will
		// settle at a lower slider position because each unit reaches
		// further out into not-quite-swing districts.
		swingBreadthSlope: 4,
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
		safe: { mean: 8, var: 4, tail: 4 },
		swing: { mean: 16, var: 8, tail: 2 },
		opp: { mean: 2, var: 0, tail: 6 },
	},

	// ---------------- ELECTION-NOISE PER-DISTRICT MODULATION -------------------
	// The additive election-noise σ (= the sqrtSigmaN slider squared,
	// scaling a unit-variance bates / tukey draw added to z) gets dialled
	// UP in safe seats by a saturating linear ramp on |d_i − medianLean|:
	//
	//   sigmaN_i = sigmaN · (1 + safeAmp · min(|d_i − medianLean| / safeSaturation, 1))
	//
	// Same saturating-ramp shape as `intentionalMod.opp`'s "stretch from
	// the median", but symmetric around the median so it applies to safe
	// seats of EITHER party.  Captures the real-world fact that the
	// margin of victory in a 70-30 seat fluctuates harder year-to-year
	// than a 51-49 seat — there's no two-way pressure pulling toward the
	// observed median, so candidate quirks / turnout swings / generic-
	// ballot drift hit the actual vote share without being washed out by
	// the close-race tug-of-war.
	//
	// Tunables:
	//   safeAmp        — multiplier of extra noise at full saturation
	//                    (0 → off; 0.5 → up to 1.5× σ in fully-safe seats).
	//   safeSaturation — |d_i − medianLean| (% points) where the ramp
	//                    plateaus.  Anything past this gets the full bump.
	electionNoise: {
		safeAmp: 0,
		safeSaturation: 20,
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
		// District-partisan lean histogram (bottom chart): bin width in
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

	// ---------------- HISTORICAL PER-YEAR PRESETS (historical.html only) ------
	// One pre-baked auto-fit preset per cycle 1992-2024.  Wired to the
	// dynamic "Approximate <year> election" button in the historical
	// sidebar; the button reads CONFIG.historicalPresets[selectedYear]
	// and applies it via the same uncheck-→-apply-→-re-pin-Opp flow as
	// presets on the simulator page.
	//
	// Generated by `window.batchAutoFitYears({ nsim: 3000 })` (see the
	// "Regen historical presets recipe" memory note).  Each preset's
	// final fit metrics are noted in the trailing comment — all are
	// well under the 0.46 W² calibration ceiling.  Re-run the recipe
	// after changing CONFIG.historicalSqrtQualImpByYear (or any
	// structural model knob) to refresh.
	historicalPresets: {
		1992: {
			v: -5.2,
			rGerry: 0.21,
			dGerry: 0.166,
			urbanGerry: 0.005,
			dIntModSafe: 1.5,
			rIntModSafe: 1.35,
			dIntModSwing: 1.4,
			rIntModSwing: 1.4,
			dIntModOpp: 0.8,
			rIntModOpp: 1.3,
			sqrtQualImp: 0.99,
			sqrtSigmaN: 0.7,
			incumbency: 4,
		}, // medianΔ=0.00 Δ=7.08 W²=0.05
		1994: {
			v: 7,
			rGerry: 0.21,
			dGerry: 0.166,
			urbanGerry: 0.005,
			dIntModSafe: 1.5,
			rIntModSafe: 1.4,
			dIntModSwing: 1.6,
			rIntModSwing: 1.35,
			dIntModOpp: 0.35,
			rIntModOpp: 0.55,
			sqrtQualImp: 0.95,
			sqrtSigmaN: 0.3,
			incumbency: 3.25,
		}, // medianΔ=0.00 Δ=7.08 W²=0.05
		1996: {
			v: 0.4,
			rGerry: 0.214,
			dGerry: 0.166,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 1.4,
			rIntModSwing: 1.5,
			dIntModOpp: 0.15,
			rIntModOpp: 1.1,
			sqrtQualImp: 0.96,
			sqrtSigmaN: 0.6,
			incumbency: 1.25,
		}, // medianΔ=0.01 Δ=6.15 W²=0.07
		1998: {
			v: 0.9,
			rGerry: 0.214,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 1.7,
			rIntModSwing: 1.5,
			dIntModOpp: 0.2,
			rIntModOpp: 1.6,
			sqrtQualImp: 0.92,
			sqrtSigmaN: 0.4,
			incumbency: 4.5,
		}, // medianΔ=0.00 Δ=6.39 W²=0.05
		2000: {
			v: 0.3,
			rGerry: 0.214,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 1.5,
			rIntModSwing: 1.5,
			dIntModOpp: 0.75,
			rIntModOpp: 2.3,
			sqrtQualImp: 0.89,
			sqrtSigmaN: 0.4,
			incumbency: 4.75,
		}, // medianΔ=0.05 Δ=5.00 W²=0.07
		2002: {
			v: 4.6,
			rGerry: 0.255,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 1.8,
			rIntModSwing: 1.5,
			dIntModOpp: 1.4,
			rIntModOpp: 2.65,
			sqrtQualImp: 0.87,
			sqrtSigmaN: 0.9,
			incumbency: 6,
		}, // medianΔ=0.02 Δ=4.14 W²=0.04
		2004: {
			v: 2.6,
			rGerry: 0.255,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 2,
			rIntModSwing: 1.6,
			dIntModOpp: 2.25,
			rIntModOpp: 2.5,
			sqrtQualImp: 0.84,
			sqrtSigmaN: 0.9,
			incumbency: 3.25,
		}, // medianΔ=0.05 Δ=4.03 W²=0.19
		2006: {
			v: -6.4,
			rGerry: 0.265,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.6,
			rIntModSafe: 1.4,
			dIntModSwing: 1.5,
			rIntModSwing: 1.6,
			dIntModOpp: 1.4,
			rIntModOpp: 2.85,
			sqrtQualImp: 0.83,
			sqrtSigmaN: 0.5,
			incumbency: 1,
		}, // medianΔ=0.09 Δ=4.09 W²=0.09
		2008: {
			v: -9.5,
			rGerry: 0.214,
			dGerry: 0.153,
			urbanGerry: 0.01,
			dIntModSafe: 1.4,
			rIntModSafe: 1.4,
			dIntModSwing: 1,
			rIntModSwing: 1.5,
			dIntModOpp: 1.85,
			rIntModOpp: 1.15,
			sqrtQualImp: 0.78,
			sqrtSigmaN: 1,
			incumbency: 6.5,
		}, // medianΔ=0.09 Δ=3.91 W²=0.14
		2010: {
			v: 5.1,
			rGerry: 0.225,
			dGerry: 0.153,
			urbanGerry: 0.01,
			dIntModSafe: 1.4,
			rIntModSafe: 1.35,
			dIntModSwing: 1.6,
			rIntModSwing: 1.45,
			dIntModOpp: 1.15,
			rIntModOpp: 0.8,
			sqrtQualImp: 0.72,
			sqrtSigmaN: 1.1,
			incumbency: 2.5,
		}, // medianΔ=0.00 Δ=3.86 W²=0.03
		2012: {
			v: -2.4,
			rGerry: 0.265,
			dGerry: 0.153,
			urbanGerry: 0.01,
			dIntModSafe: 1.4,
			rIntModSafe: 1.3,
			dIntModSwing: 1.75,
			rIntModSwing: 1.5,
			dIntModOpp: 0.15,
			rIntModOpp: 1.05,
			sqrtQualImp: 0.71,
			sqrtSigmaN: 1,
			incumbency: 0.75,
		}, // medianΔ=0.02 Δ=4.76 W²=0.03
		2014: {
			v: 5.1,
			rGerry: 0.259,
			dGerry: 0.149,
			urbanGerry: 0.01,
			dIntModSafe: 1.4,
			rIntModSafe: 1.25,
			dIntModSwing: 1.95,
			rIntModSwing: 1.6,
			dIntModOpp: 1.3,
			rIntModOpp: 2.55,
			sqrtQualImp: 0.67,
			sqrtSigmaN: 0.8,
			incumbency: 0.75,
		}, // medianΔ=0.07 Δ=4.55 W²=0.05
		2016: {
			v: 1.6,
			rGerry: 0.242,
			dGerry: 0.16,
			urbanGerry: 0.005,
			dIntModSafe: 1.4,
			rIntModSafe: 1.15,
			dIntModSwing: 1.65,
			rIntModSwing: 1.65,
			dIntModOpp: 1.5,
			rIntModOpp: 2.3,
			sqrtQualImp: 0.63,
			sqrtSigmaN: 1.1,
			incumbency: 1.5,
		}, // medianΔ=0.06 Δ=6.18 W²=0.03
		2018: {
			v: -7.3,
			rGerry: 0.252,
			dGerry: 0.16,
			urbanGerry: 0.005,
			dIntModSafe: 1.4,
			rIntModSafe: 1.2,
			dIntModSwing: 1.4,
			rIntModSwing: 1.6,
			dIntModOpp: 1.05,
			rIntModOpp: 1.4,
			sqrtQualImp: 0.58,
			sqrtSigmaN: 1.4,
			incumbency: 1.25,
		}, // medianΔ=0.03 Δ=5.78 W²=0.03
		2020: {
			v: -2.1,
			rGerry: 0.214,
			dGerry: 0.16,
			urbanGerry: 0.005,
			dIntModSafe: 1.4,
			rIntModSafe: 1.25,
			dIntModSwing: 1.5,
			rIntModSwing: 1.6,
			dIntModOpp: 1.05,
			rIntModOpp: 1.4,
			sqrtQualImp: 0.55,
			sqrtSigmaN: 1.1,
			incumbency: 7,
		}, // medianΔ=0.02 Δ=5.95 W²=0.15
		2022: {
			v: 1.6,
			rGerry: 0.214,
			dGerry: 0.16,
			urbanGerry: 0.005,
			dIntModSafe: 1.4,
			rIntModSafe: 1.2,
			dIntModSwing: 2,
			rIntModSwing: 1.5,
			dIntModOpp: 0.9,
			rIntModOpp: 1.8,
			sqrtQualImp: 0.49,
			sqrtSigmaN: 1,
			incumbency: 3.25,
		}, // medianΔ=0.01 Δ=5.62 W²=0.04
		2024: {
			v: 2.2,
			rGerry: 0.194,
			dGerry: 0.164,
			urbanGerry: 0.005,
			dIntModSafe: 1.35,
			rIntModSafe: 1.15,
			dIntModSwing: 1.5,
			rIntModSwing: 1.4,
			dIntModOpp: 0.45,
			rIntModOpp: 1.4,
			sqrtQualImp: 0.45,
			sqrtSigmaN: 0.6,
			incumbency: 1.75,
		}, // medianΔ=0.02 Δ=4.61 W²=0.04
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
			// Hand-tuned for the simulator page's synthetic-chamber
			// view (different from CONFIG.historicalPresets[2024],
			// which is auto-fit to the REAL 2024 districts and uses
			// incumbency — neither concept exists here).  v pinned to
			// the year's SHAVE-adjusted House popular-vote margin.
			v: 2.1,
			rGerry: 0.195,
			dGerry: 0.165,
			dIntModSafe: 1,
			rIntModSafe: 1,
			dIntModSwing: 1.4,
			rIntModSwing: 0.5,
			dIntModOpp: 1,
			rIntModOpp: 1,
			sqrtQualImp: 0.45,
			sqrtSigmaN: 0.5,
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
			sqrtQualImp: 0, // wMod = 0 → no candidate-ideology pull on z
			sigmaN: 5,
		},
	},
};
