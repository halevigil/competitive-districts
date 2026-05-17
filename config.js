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
		// `quadratic: true` makes the slider's effective multiplier the
		// SQUARE of its normalised position — effective = (slider/def)²
		// (or slider² when def = 0).  Perceptual scale at the slider
		// stays linear; the underlying intMod multiplier grows
		// quadratically.  Same convention as sqrtSigmaN / sqrtQualImp.
		// Useful when small slider changes near zero need much-finer
		// resolution than linear scaling allows.  Default false on all
		// three.  CMA-ES auto-fit also respects the flag automatically
		// (it samples in slider-space, the squaring happens inside
		// readParams every probe).
		intModSafe: { max: 3, step: 0.05, value: 1, quadratic: false },
		intModSwing: { max: 3, step: 0.05, value: 1, quadratic: true },
		intModOpp: { max: 3, step: 0.05, value: 1, quadratic: true },

		// How heavily voters punish ideologically extreme candidates
		// relative to district partisan lean.  Slider value goes
		// directly to `wMod`; range [0, 1] covers fully indifferent to
		// dominant.
		qualImp: { min: 0, max: 1, step: 0.01, value: 0.5 },

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
		incumbency: { min: 0, max: 9, step: 0.25, value: 3 },

		// Live PVI-weight sliders (historical.html only, gated behind
		// CONFIG.pviWeightSliders.enabled).  Each is the PREV-pres
		// share of the PVI denominator: prev / (cur + prev).  Defaults
		// match the static CONFIG.pviWeights ratios above (4:1 → 0.2,
		// 2:1 → 0.333) so toggling the flag on doesn't change anything
		// until the slider is moved.
		presPrevWeight: { min: 0, max: 0.5, step: 0.01, value: 0.2 },
		midtermPrevWeight: { min: 0, max: 0.5, step: 0.01, value: 0.333 },
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
		mean: 0,
		var: 0,
		tail: 0,
	},

	// ---------------- INCUMBENCY SLIDER VISIBILITY (historical.html only) -----
	// When false (default), the Incumbency Advantage slider is hidden
	// from "Practical Details", forced to 0 on init (so the simulator
	// runs with incumbency disabled), and excluded from the auto-fit
	// candidate list — CMA-ES won't waste evals on a knob the user
	// can't see.  Set to true to restore the previous behaviour.
	showIncumbencySlider: false,

	// ---------------- SIMULATOR-ON-SYNTHETIC-CHAMBER ROW (historical only) ----
	// When true, restore a third row under the simulator-on-year row:
	// the simulator running on its OWN analytic district pool (built
	// from rGerry / dGerry / base / gerry) instead of the year's real
	// pool.  Useful for seeing how the converged auto-fit parameters
	// project onto an idealised chamber.  Renders live from the same
	// CONTROLS.readParams() the rest of the page uses, so no cross-tab
	// localStorage dependency.  Default false (the row was retired
	// because it duplicated the simulator page's view).
	showSimulatorOnSyntheticChamber: true,

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

	// ---------------- LIVE PVI-WEIGHT SLIDERS (historical.html only) -----------
	// Optional: when `enabled: true`, two extra sliders appear under
	// "Practical Details" — `presPrevWeight` (default 0.2 = 1/5, the
	// previous-pres share in the PVI for presidential years) and
	// `midtermPrevWeight` (default 0.333 = 1/3, the older-pres share in
	// the PVI for midterm years).  Sliders override CONFIG.pviWeights
	// live: changing them rebuilds the per-district lean pool for the
	// selected year and re-runs the simulator.  Auto-fit also includes
	// them in the candidate-stage CMA-ES sweep, so the optimiser can
	// tune the historical lean axis itself.  When `enabled: false`
	// (default), the sliders aren't rendered, the page reads weights
	// straight from `pviWeights` above, and there's zero overhead — the
	// pool stays baked at page-init like before.
	pviWeightSliders: {
		enabled: false,
	},

	// ---------------- AUTO-FIT WINNER-PREDICTION LOSS (historical.html only) --
	// Auto-fit's W² loss measures the empirical PIT calibration on
	// CONTESTED districts only — it cares about whether the simulator's
	// predicted distribution covers the actual margin in the right
	// percentile, but not whether the simulator picks the winning party.
	// This optional Brier-style term penalises winner mispredictions
	// across ALL districts (uncontested included; the actual winner is
	// known there even when the margin sentinel is ±100):
	//   loss_winner_i = (P(R wins | sim) − I[actual winner = R])²
	// summed over all districts whose actual winner is known.  Weighted
	// by `weight` and added to evalW2's return value, so the Brier mass
	// becomes part of the same objective coordinate descent minimises.
	// Set weight to 0 to disable entirely (current default → behaviour
	// unchanged).  At nsim=3000 the per-district Brier-noise floor is
	// ~3e-4, summed over ~435 districts ~0.13; pick `weight` so the
	// resulting contribution is on the same order as W² (~0.05–0.5)
	// when you want the term to actually steer the fit.
	autoFitWinnerLoss: {
		weight: 1,
	},

	// ---------------- AUTO-FIT REGULARIZATION (historical.html only) ----------
	// Per-slider quadratic pull toward a "prior" value, added to evalW2
	// to keep the optimiser from over-relying on a single slider to
	// absorb structural mismatches.  Per-slider contribution:
	//   penalty_i = weight_i · (slider_value_i − prior_i)²
	// Each entry takes:
	//   weight       — absolute pull (units of W²-objective).  0 disables.
	//   prior        — scalar target the slider gets pulled toward.
	//   priorByYear  — alternative to `prior`: a {year → value} map for
	//                  cycle-specific priors (used for qualImp where
	//                  the right wMod genuinely varies year-to-year).
	//                  Falls through to `prior` then to the slider's
	//                  CONFIG default if the year isn't listed.
	// Pick weights to be comparable to W² + winner-Brier sums (~0.1–1).
	// Incumbency has the widest range (0-6) so a smaller weight gives
	// equivalent pull.  Setting weights too high pins the slider at the
	// prior; too low and the model overuses that knob.
	//
	// Note: the regularization prior is INDEPENDENT of where the slider
	// starts each fit.  The auto-fit batch resets every slider to its
	// CONFIG default before each year — `prior` / `priorByYear` only
	// influences the W² objective, not the starting value.
	//
	// `radius` (optional) — when set, the random-search candidate stage
	// in autoFitToYear samples this slider only within
	//   [prior − radius, prior + radius]
	// (clamped to [slider.min, slider.max]) instead of the full slider
	// range.  Use to keep the optimiser from wandering far from the
	// regularised prior in the global random search; the regularisation
	// term still penalises deviations the same way regardless.  Omit to
	// sample full-range.  `radius: 0` is a hard pin: the slider is
	// fixed at its prior for the whole fit and skipped from sampling
	// entirely (the regularisation weight then has no effect on this
	// slider since it can never deviate).
	autoFitRegularization: {
		// House popular-vote margin slider (R+x).  Per-year priors:
		//   - Presidential years: the cycle's national TWO-PARTY
		//     PRESIDENTIAL margin (R−D, pp).  Mirrors the
		//     NATIONAL_PRES_MARGIN map in historical.html.  Anchors the
		//     wave to the same signal that drives the per-district lean
		//     axis on those years.
		//   - Midterm years: SHAVE-adjusted (Split Ticket, 2010+) /
		//     Brookings Vital Stats (pre-2010) HOUSE popular vote
		//     margin, same as the old static pin used.
		// The optimiser is free to move v within the slider range; the
		// weight pulls it back toward the cycle's prior so wave error
		// doesn't get absorbed into rGerry / candidate noise.
		v: {
			weight: 0.5,
			radius: 10,
			priorByYear: {
				// Presidential years — national pres margin (R−D, two-party).
				1992: -5.56,
				1996: -8.51,
				2000: -0.51,
				2004: 2.46,
				2008: -7.27,
				2012: -3.86,
				2016: -2.1,
				2020: -4.45,
				2024: 1.48,
				// Midterm years — SHAVE/Brookings House popular vote.
				1994: 5,
				1998: 0.9,
				2002: 5,
				2006: -8,
				2010: 7,
				2014: 5.06,
				2018: -8,
				2022: 1.59,
			},
		},
		qualImp: {
			weight: 1,
			radius: 10,
			// Year-agnostic fallback prior, used for any year not
			// listed in priorByYear below.  Resolution chain in
			// historical.html is priorByYear[year] → prior → slider's
			// CONFIG default value, so `prior` here is the second-
			// preference target.
			prior: 0.5,
			// Per-cycle qualImp priors (= wMod, since this slider is
			// linear).  Linearly interpolated from 0.25 in 2024 up to
			// 0.75 in 1992 (Δ = 0.5 / 16 cycles ≈ 0.03125 per cycle,
			// rounded to 2dp) — captures the prior belief that
			// candidate quality / personal vote mattered MORE in the
			// pre-nationalised pre-2010s House.
			// priorByYear: {
			// 	2024: 0.25,
			// 	2022: 0.28,
			// 	2020: 0.31,
			// 	2018: 0.34,
			// 	2016: 0.38,
			// 	2014: 0.41,
			// 	2012: 0.44,
			// 	2010: 0.47,
			// 	2008: 0.5,
			// 	2006: 0.53,
			// 	2004: 0.56,
			// 	2002: 0.59,
			// 	2000: 0.63,
			// 	1998: 0.66,
			// 	1996: 0.69,
			// 	1994: 0.72,
			// 	1992: 0.75,
			// },
			// priorByYear: {
			// 	2024: 0.7, // wMod = 0.49
			// 	2022: 0.5, // wMod = 0.25
			// 	2020: 0.55, // wMod = 0.30
			// 	2018: 0.59, // wMod = 0.35
			// 	2016: 0.63, // wMod = 0.40
			// 	2014: 0.67, // wMod = 0.45
			// 	2012: 0.71, // wMod = 0.50
			// 	2010: 0.74, // wMod = 0.55
			// 	2008: 0.77, // wMod = 0.60
			// 	2006: 0.81, // wMod = 0.65
			// 	2004: 0.84, // wMod = 0.70
			// 	2002: 0.87, // wMod = 0.75
			// 	2000: 0.89, // wMod = 0.80
			// 	1998: 0.92, // wMod = 0.85
			// 	1996: 0.95, // wMod = 0.90
			// 	1994: 0.97, // wMod = 0.95
			// 	1992: 1.0, // wMod = 1.00 (slider max)
			// },
		},
		sqrtSigmaN: {
			weight: 0.1,
			prior: 0.5, // matches the slider's CONFIG default
			radius: 0,
		},
		incumbency: {
			weight: 0.01,
			prior: 3, // matches the slider's CONFIG default
			radius: 10,
		},
	},

	// ---------------- AUTO-FIT SAMPLE BUDGETS (historical.html only) --------
	// Per-stage budgets in autoFitToYear.
	//   districtMapSamples — total grid points for the GRID SEARCH over
	//                        (rGerry, dGerry).  Implementation uses
	//                        √districtMapSamples per axis (rounded), so a
	//                        value of 10000 gives a 100×100 grid.  Each
	//                        eval is a sorted-pool comparison (~3 ms),
	//                        so this can be cranked freely.
	//   candidateSamples   — eval budget for the CMA-ES candidate stage
	//                        (intMod safe/swing/opp × D/R, qualImp,
	//                        sqrtSigmaN, plus v and optional PVI/incumbency
	//                        if their flags are on).  Each eval is a full
	//                        nsim simulator run, so cost scales linearly:
	//                        candidateSamples × nsim × per-sim time.
	autoFitRandomSearch: {
		districtMapSamples: 500 ** 2,
		candidateSamples: 300,
	},

	// ---------------- TAIL HEAVINESS (intMod tail + incumbency tail) ----------
	// Shape exponent applied to every Laplace tail draw before scaling
	// by the per-block `tail` config.  Controls how extreme the rare
	// outlier candidates / incumbents are; the per-block `tail`
	// continues to control AMPLITUDE.  See model.js → tailSample().
	//   1.0 → Laplace, the historical default.
	//   1.5 → noticeably heavier than Laplace.
	//   2.0 → very heavy (stretched-exponential tail, much more
	//         extreme than Laplace; a single draw can blow up z by
	//         dozens of pp on the rare end).
	//   <1  → lighter (toward Gaussian-like as it approaches 0).
	// Affects ALL tail draws across both the simulator page and the
	// historical page.  Crank gradually — small bumps from 1.0 already
	// produce visibly heavier outlier behaviour in the chamber.
	tailHeaviness: 1,

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
	showCalibrationPlots: true,

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
	},

	// ---------------- CANDIDATE BASE MAGNITUDE ---------------------------------
	// Before any moderation, candidate ideology is a point mass at ±magnitude
	// (D at −magnitude, R at +magnitude).  All spread comes from
	// intentionalMod.{safe,swing,opp}.std; all Laplace-tail from .tail.
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
	//   - std:  added to the Gaussian-core σ of cD / cR.
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
		swingBreadthSlope: 0,
		// Opp ramp saturation: stretch distance (% points) at which the
		// linear "deeper-into-opp-territory" effect plateaus.
		oppSaturation: 20,
		// (The standalone oppSliderQuadratic flag was retired — see
		// CONFIG.sliders.intModOpp.quadratic, which sits alongside the
		// matching intModSafe/intModSwing per-slider flags.)
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
		safe: { mean: 8, std: 8, tail: 0 },
		swing: { mean: 8, std: 0, tail: 0 },
		opp: { mean: -8, std: 0, tail: 8 },
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
	// final fit metrics are noted in the trailing comment.  Re-run the
	// recipe after changing CONFIG.autoFitRegularization (priors or
	// weights), tailHeaviness, autoFitWinnerLoss, or any other
	// structural knob to refresh.  The batch helper resets every
	// slider to its CONFIG default before each year so each cycle
	// starts from a clean
	// baseline (qualImp gets re-seeded from the per-year map by
	// autoFitToYear immediately after the reset).
	historicalPresets: {
		1992: {
			v: -5.6,
			rGerry: 0.111,
			dGerry: 0.059,
			dIntModSafe: 2.6,
			rIntModSafe: 2.35,
			dIntModSwing: 1,
			rIntModSwing: 1,
			dIntModOpp: 2.3,
			rIntModOpp: 0.6,
			qualImp: 0.62,
			sqrtSigmaN: 0.4,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		1994: {
			v: 5,
			rGerry: 0.111,
			dGerry: 0.059,
			dIntModSafe: 2.85,
			rIntModSafe: 1.8,
			dIntModSwing: 0.95,
			rIntModSwing: 1.55,
			dIntModOpp: 2.5,
			rIntModOpp: 0.6,
			qualImp: 0.65,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		1996: {
			v: -8.5,
			rGerry: 0.08,
			dGerry: 0.017,
			dIntModSafe: 1.15,
			rIntModSafe: 2.6,
			dIntModSwing: 0.8,
			rIntModSwing: 0.95,
			dIntModOpp: 1.95,
			rIntModOpp: 1.5,
			qualImp: 0.68,
			sqrtSigmaN: 0.8,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		1998: {
			v: -0.2,
			rGerry: 0.078,
			dGerry: 0.012,
			dIntModSafe: 2.9,
			rIntModSafe: 1.75,
			dIntModSwing: 0.55,
			rIntModSwing: 1.65,
			dIntModOpp: 2.75,
			rIntModOpp: 2.05,
			qualImp: 0.59,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2000: {
			v: -0.5,
			rGerry: 0.095,
			dGerry: 0.03,
			dIntModSafe: 2.35,
			rIntModSafe: 2.05,
			dIntModSwing: 0.7,
			rIntModSwing: 1.4,
			dIntModOpp: 2.1,
			rIntModOpp: 1.7,
			qualImp: 0.66,
			sqrtSigmaN: 0.2,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2002: {
			v: 4.2,
			rGerry: 0.213,
			dGerry: 0.112,
			dIntModSafe: 2.9,
			rIntModSafe: 1.9,
			dIntModSwing: 1.2,
			rIntModSwing: 2.05,
			dIntModOpp: 2.1,
			rIntModOpp: 1.2,
			qualImp: 0.62,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2004: {
			v: 2.3,
			rGerry: 0.195,
			dGerry: 0.087,
			dIntModSafe: 2.8,
			rIntModSafe: 1,
			dIntModSwing: 0.45,
			rIntModSwing: 2.05,
			dIntModOpp: 2.3,
			rIntModOpp: 0.65,
			qualImp: 0.62,
			sqrtSigmaN: 0.6,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2006: {
			v: -8,
			rGerry: 0.221,
			dGerry: 0.105,
			dIntModSafe: 2.65,
			rIntModSafe: 2.15,
			dIntModSwing: 0.95,
			rIntModSwing: 1.85,
			dIntModOpp: 2.35,
			rIntModOpp: 0.9,
			qualImp: 0.5,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2008: {
			v: -7.3,
			rGerry: 0.124,
			dGerry: 0.055,
			dIntModSafe: 2.25,
			rIntModSafe: 1.55,
			dIntModSwing: 0.8,
			rIntModSwing: 1.4,
			dIntModOpp: 2.1,
			rIntModOpp: 0.25,
			qualImp: 0.63,
			sqrtSigmaN: 0.7,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2010: {
			v: 7,
			rGerry: 0.125,
			dGerry: 0.041,
			dIntModSafe: 2.05,
			rIntModSafe: 0.75,
			dIntModSwing: 1,
			rIntModSwing: 1.75,
			dIntModOpp: 2.15,
			rIntModOpp: 0.95,
			qualImp: 0.53,
			sqrtSigmaN: 0.3,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2012: {
			v: -3.8,
			rGerry: 0.184,
			dGerry: 0.047,
			dIntModSafe: 1.2,
			rIntModSafe: 1.1,
			dIntModSwing: 0.5,
			rIntModSwing: 1.65,
			dIntModOpp: 1.55,
			rIntModOpp: 1.35,
			qualImp: 0.52,
			sqrtSigmaN: 0.6,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2014: {
			v: 5.1,
			rGerry: 0.244,
			dGerry: 0.14,
			dIntModSafe: 1.95,
			rIntModSafe: 1.15,
			dIntModSwing: 0.35,
			rIntModSwing: 1.75,
			dIntModOpp: 1.2,
			rIntModOpp: 0.95,
			qualImp: 0.52,
			sqrtSigmaN: 0.6,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2016: {
			v: -2.1,
			rGerry: 0.232,
			dGerry: 0.151,
			dIntModSafe: 1.05,
			rIntModSafe: 2,
			dIntModSwing: 0.6,
			rIntModSwing: 1.5,
			dIntModOpp: 0.9,
			rIntModOpp: 1.7,
			qualImp: 0.45,
			sqrtSigmaN: 0.4,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2018: {
			v: -8,
			rGerry: 0.252,
			dGerry: 0.166,
			dIntModSafe: 0.8,
			rIntModSafe: 1.05,
			dIntModSwing: 1,
			rIntModSwing: 0.45,
			dIntModOpp: 1.3,
			rIntModOpp: 1.15,
			qualImp: 0.51,
			sqrtSigmaN: 0.6,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2020: {
			v: -4.4,
			rGerry: 0.222,
			dGerry: 0.175,
			dIntModSafe: 0.35,
			rIntModSafe: 1,
			dIntModSwing: 0.9,
			rIntModSwing: 0.15,
			dIntModOpp: 1.15,
			rIntModOpp: 1.15,
			qualImp: 0.43,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2022: {
			v: 1.6,
			rGerry: 0.235,
			dGerry: 0.19,
			dIntModSafe: 1.05,
			rIntModSafe: 0.95,
			dIntModSwing: 0.95,
			rIntModSwing: 0.45,
			dIntModOpp: 0.6,
			rIntModOpp: 1.15,
			qualImp: 0.45,
			sqrtSigmaN: 0.5,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
		2024: {
			v: 1.5,
			rGerry: 0.197,
			dGerry: 0.172,
			dIntModSafe: 0.5,
			rIntModSafe: 0.9,
			dIntModSwing: 1.43,
			rIntModSwing: 0.75,
			dIntModOpp: 0.95,
			rIntModOpp: 1.3,
			qualImp: 0.42,
			sqrtSigmaN: 0.7,
			incumbency: 3,
			presPrevWeight: 0.2,
			midtermPrevWeight: 0.33,
		},
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
		// "Approximate 2024 Election" is injected after the CONFIG
		// literal closes (see bottom of this file).  It mirrors
		// `historicalPresets[2024]` minus the historical-only fields
		// (incumbency, presPrevWeight, midtermPrevWeight), so any
		// auto-fit re-tune of the historical 2024 preset automatically
		// flows through to the simulator's quick-start button.
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
			qualImp: 0.0, // wMod = 0 → no candidate-ideology pull on z
			sigmaN: 5,
		},
	},
};

// Derive the simulator-page "Approximate 2024 Election" preset from the
// historical-page 2024 auto-fit so retuning the latter automatically
// updates the simulator's quick-start button.  Strips the historical-
// only fields (incumbency, presPrevWeight, midtermPrevWeight) that
// don't exist as simulator-page sliders — index.html's preset wiring
// would skip them anyway, but cleaner not to pass them through.
(function syncSim2024PresetFromHistorical() {
	const h =
		window.CONFIG.historicalPresets &&
		window.CONFIG.historicalPresets[2024];
	if (!h) return;
	const { incumbency, presPrevWeight, midtermPrevWeight, ...simFields } = h;
	window.CONFIG.presets = window.CONFIG.presets || {};
	window.CONFIG.presets["Approximate 2024 Election"] = simFields;
})();
