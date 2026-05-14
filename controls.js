// =============================================================================
// controls.js — shared parameter-panel binding for the simulator's sliders.
//
// Both index.html (the simulator) and historical.html (where the same sliders
// live alongside the historical-comparison charts) include this file so the
// slider HTML, pin-pair behaviour, presets, reset, and readParams logic exist
// in one place.
//
// Usage from the host page:
//   CONTROLS.bind({ onRun: (params) => { ... } })
//
// The host page is responsible for:
//   * embedding the controls panel HTML (sliders with the exact IDs below)
//   * loading config.js + model.js
//   * doing whatever rendering it wants from inside its onRun callback
//
// `onRun` is called debounced (~120ms after a slider stops moving) and once
// immediately during bind() so the host can render its initial chart state.
// =============================================================================

(function () {
	const SLIDER_IDS = [
		"v",
		"rGerry",
		"dGerry",
		"urbanGerry",
		"dIntModSafe",
		"rIntModSafe",
		"dIntModSwing",
		"rIntModSwing",
		"dIntModOpp",
		"rIntModOpp",
		"qualImp",
		"sqrtSigmaN",
		// Historical-only knob (per-district incumbency boost on the
		// simulator-on-year row).  index.html doesn't render the
		// slider element so wireSlider just no-ops there.
		"incumbency",
	];

	// Pairs of sliders that share a "move both together" pin checkbox.  When
	// the pin is checked, dragging either slider shifts the other by the same
	// delta — the offset between them is preserved, not the absolute equality.
	const PINNED_PAIRS = [
		{ d: "dGerry", r: "rGerry", pin: "dGerry_rGerry_pin" },
		{ d: "dIntModSafe", r: "rIntModSafe", pin: "dIntModSafe_rIntModSafe_pin" },
		{ d: "dIntModSwing", r: "rIntModSwing", pin: "dIntModSwing_rIntModSwing_pin" },
		{ d: "dIntModOpp", r: "rIntModOpp", pin: "dIntModOpp_rIntModOpp_pin" },
	];

	// Sliders that get an editable numeric readout next to them.
	// Other sliders just have the slider; readParams reads from the slider directly.
	const VISIBLE_NUMERIC = new Set(); // none — popular vote uses a custom "R+x%/D+x%" display

	function formatVal(id, f) {
		const range = document.getElementById(id);
		const stepStr = range && range.step ? String(range.step) : "0.01";
		const dot = stepStr.indexOf(".");
		const decimals = dot < 0 ? 0 : stepStr.length - dot - 1;
		return f.toFixed(decimals);
	}

	function formatVote(v) {
		if (Math.abs(v) < 1e-6) return { text: "Tied", cls: "" };
		if (v > 0) return { text: `R+${v.toFixed(1)}%`, cls: "r" };
		return { text: `D+${(-v).toFixed(1)}%`, cls: "d" };
	}
	function updateVoteDisplay() {
		const range = document.getElementById("v");
		const disp = document.getElementById("v_display");
		if (!range || !disp) return;
		const { text, cls } = formatVote(parseFloat(range.value));
		disp.textContent = text;
		disp.className = "vote-display" + (cls ? " " + cls : "");
	}

	// Build the full simulator param object from the current slider state.
	// Mirrors what `simulateOne` consumes — kept in lockstep with model.js.
	function readParams() {
		const num = (id) => {
			const numInput = document.getElementById(id + "_v");
			if (numInput) return parseFloat(numInput.value);
			return parseFloat(document.getElementById(id).value);
		};
		const cfg = window.CONFIG;
		const CONST = cfg.constants;
		const bDSafe = num("dIntModSafe");
		const bRSafe = num("rIntModSafe");
		const bDSwing = num("dIntModSwing");
		const bRSwing = num("rIntModSwing");
		const bDOpp = num("dIntModOpp");
		const bROpp = num("rIntModOpp");
		const im = cfg.intentionalMod;
		const magnitude = cfg.candidateMagnitude ?? 100;
		const safeDef = cfg.sliders.dIntModSafe.value;
		const swingDef = cfg.sliders.dIntModSwing.value;
		const oppDef = cfg.sliders.dIntModOpp.value;
		const resolveBlock = (block, bD, bR, def) => {
			const bk = block || {};
			const sD = bD / def;
			const sR = bR / def;
			return {
				meanD: sD * (bk.mean ?? 0),
				meanR: sR * (bk.mean ?? 0),
				varD: sD * (bk.var ?? 0),
				varR: sR * (bk.var ?? 0),
				tailD: sD * (bk.tail ?? 0),
				tailR: sR * (bk.tail ?? 0),
			};
		};
		return {
			m: CONST.m,
			nsim: CONST.nsim,
			v: num("v"),
			epsPct: CONST.epsPct,
			sqrtSigmaN: document.getElementById("sqrtSigmaN")
				? num("sqrtSigmaN")
				: CONST.sqrtSigmaN,
			noiseType: CONST.noiseType ?? "bates",
			batesN: CONST.bates?.N ?? 3,
			tukeyLambda: CONST.tukey?.lambda ?? 0.14,
			rGerry: num("rGerry"),
			dGerry: num("dGerry"),
			urbanGerry: document.getElementById("urbanGerry") ? num("urbanGerry") : 0,
			base: cfg.districtBase,
			gerry: cfg.districtGerry,
			urban: cfg.districtUrban,
			muD: -magnitude,
			muR: +magnitude,
			wMod: num("qualImp"),
			safe: resolveBlock(im.safe, bDSafe, bRSafe, safeDef),
			swing: (() => {
				// Per-party effective bell breadth: anchored at swingBreadth
				// when the slider sits at its default, then nudged by
				// swingBreadthSlope per unit-slider above default.  Each
				// party's slider drives its own bell so an unpinned auto-
				// fit can reach asymmetric configurations.
				const bAnchor = im.swingBreadth ?? 6;
				const bSlope = im.swingBreadthSlope ?? 0;
				const breadth = (b) => Math.max(0.5, bAnchor + bSlope * (b / swingDef - 1));
				return Object.assign(
					resolveBlock(im.swing, bDSwing, bRSwing, swingDef),
					{
						offset: im.swingOffset ?? 0,
						breadthD: breadth(bDSwing),
						breadthR: breadth(bRSwing),
					}
				);
			})(),
			opp: Object.assign(
				resolveBlock(im.opp, bDOpp, bROpp, oppDef),
				{ saturation: im.oppSaturation ?? 20 }
			),
			waveWeight: im.waveWeight ?? 0,
			// Per-district election-noise modulation: amplify σ in safe
			// seats via the same saturating-ramp shape as opp, anchored
			// at medianLean and symmetric (either-party safe).  See
			// `electionNoise` in config.js for the math.
			electionNoise: {
				safeAmp: cfg.electionNoise?.safeAmp ?? 0,
				safeSaturation: Math.max(0.5, cfg.electionNoise?.safeSaturation ?? 20),
			},
		};
	}

	// Apply CONFIG-driven slider attributes (min/max/step/default) to every
	// slider currently in the DOM.  Skips missing sliders so a host page that
	// only mounts a subset still works.  Also expands the shared D/R config
	// blocks (`gerry`, `intModSafe`, …) into per-side entries so a preset can
	// override one side without disturbing the other.
	function applySliderAttributes() {
		const sharedPairs = {
			gerry: ["rGerry", "dGerry"],
			intModSafe: ["rIntModSafe", "dIntModSafe"],
			intModSwing: ["rIntModSwing", "dIntModSwing"],
			intModOpp: ["rIntModOpp", "dIntModOpp"],
		};
		for (const [shared, ids] of Object.entries(sharedPairs)) {
			const block = window.CONFIG.sliders[shared];
			if (!block) continue;
			for (const id of ids) {
				window.CONFIG.sliders[id] = { ...block };
			}
			delete window.CONFIG.sliders[shared];
		}
		// Each intMod slider has a uniform [0, slider.max] range so the
		// default value sits at the same relative track position
		// (value / slider.max) across all three.
		const setIntModRange = (sliderIdsLR) => {
			const cfg = window.CONFIG.sliders[sliderIdsLR[0]];
			for (const id of sliderIdsLR) {
				window.CONFIG.sliders[id].min = 0;
				window.CONFIG.sliders[id].max = cfg.max;
				window.CONFIG.sliders[id].value = cfg.value;
			}
		};
		setIntModRange(["dIntModSafe", "rIntModSafe"]);
		setIntModRange(["dIntModSwing", "rIntModSwing"]);
		setIntModRange(["dIntModOpp", "rIntModOpp"]);

		for (const [id, attrs] of Object.entries(window.CONFIG.sliders)) {
			const r = document.getElementById(id);
			if (!r) continue;
			r.min = attrs.min;
			r.max = attrs.max;
			r.step = attrs.step;
			r.value = attrs.value;
			r.defaultValue = attrs.value;
		}
	}

	// Wraps each slider in a .slider-wrap div, wires up custom-track CSS
	// variables (--val / --default-pct / --lo / --hi / --fill-color), and
	// hooks an input listener that calls scheduleRun.  VISIBLE_NUMERIC
	// sliders get an editable number readout next to them.
	function wireSlider(id, scheduleRun) {
		const range = document.getElementById(id);
		if (!range) return;
		const span = document.getElementById(id + "_v"); // may be null
		if (!range.parentElement.classList.contains("slider-wrap")) {
			const wrap = document.createElement("div");
			wrap.className = "slider-wrap";
			range.parentNode.insertBefore(wrap, range);
			wrap.appendChild(range);
		}
		const wrapEl = range.parentElement;
		const lo = parseFloat(range.min),
			hi = parseFloat(range.max);
		const defaultPct =
			((parseFloat(range.defaultValue) - lo) / (hi - lo)) * 100;
		wrapEl.style.setProperty("--default-pct", defaultPct + "%");
		// Popular-vote slider diverges from a midpoint and gets a partisan-
		// coloured fill: blue (D) when left of centre, red (R) when right of
		// centre, growing out from the indicator.
		const isDivergent = id === "v";
		if (isDivergent) wrapEl.classList.add("partisan");
		const updateFill = () => {
			const pct = ((parseFloat(range.value) - lo) / (hi - lo)) * 100;
			wrapEl.style.setProperty("--val", pct + "%");
			if (isDivergent) {
				const loPct = Math.min(defaultPct, pct);
				const hiPct = Math.max(defaultPct, pct);
				wrapEl.style.setProperty("--lo", loPct + "%");
				wrapEl.style.setProperty("--hi", hiPct + "%");
				const color =
					pct > defaultPct ? "var(--r)" : pct < defaultPct ? "var(--d)" : "var(--accent)";
				wrapEl.style.setProperty("--fill-color", color);
			}
		};
		range.addEventListener("input", updateFill);
		updateFill();

		if (VISIBLE_NUMERIC.has(id) && span) {
			const numInp = document.createElement("input");
			numInp.type = "number";
			numInp.id = id + "_v";
			numInp.className = "val";
			numInp.step = range.step;
			numInp.value = formatVal(id, parseFloat(range.value));
			span.parentNode.replaceChild(numInp, span);

			range.addEventListener("input", () => {
				numInp.value = formatVal(id, parseFloat(range.value));
				scheduleRun();
			});
			numInp.addEventListener("input", () => {
				const v = parseFloat(numInp.value);
				if (!isFinite(v)) return;
				const lo2 = parseFloat(range.min),
					hi2 = parseFloat(range.max);
				range.value = Math.max(lo2, Math.min(hi2, v));
				scheduleRun();
			});
			numInp.addEventListener("change", () => {
				const v = parseFloat(numInp.value);
				if (!isFinite(v)) {
					numInp.value = formatVal(id, parseFloat(range.value));
					return;
				}
				numInp.value = formatVal(id, v);
			});
		} else {
			range.addEventListener("input", scheduleRun);
		}
	}

	// Pin-pair wiring: while the checkbox is checked, dragging either side
	// shifts the partner by the same delta (preserving the offset, not the
	// absolute equality).
	function wirePinPairs(pairs, scheduleRun) {
		for (const pair of pairs) {
			const pin = document.getElementById(pair.pin);
			const ds = document.getElementById(pair.d);
			const rs = document.getElementById(pair.r);
			if (!pin || !ds || !rs) continue;
			let dsLast = parseFloat(ds.value);
			let rsLast = parseFloat(rs.value);
			let syncing = false;
			const shift = (src, dst, getLast, setLast, setOtherLast) => {
				const newVal = parseFloat(src.value);
				if (syncing || !pin.checked) {
					setLast(newVal);
					setOtherLast(parseFloat(dst.value));
					return;
				}
				const delta = newVal - getLast();
				setLast(newVal);
				if (delta === 0) {
					setOtherLast(parseFloat(dst.value));
					return;
				}
				const lo = parseFloat(dst.min);
				const hi = parseFloat(dst.max);
				const target = Math.max(lo, Math.min(hi, parseFloat(dst.value) + delta));
				syncing = true;
				dst.value = target;
				dst.dispatchEvent(new Event("input", { bubbles: true }));
				syncing = false;
				setOtherLast(parseFloat(dst.value));
			};
			ds.addEventListener("input", () =>
				shift(ds, rs, () => dsLast, (v) => (dsLast = v), (v) => (rsLast = v))
			);
			rs.addEventListener("input", () =>
				shift(rs, ds, () => rsLast, (v) => (rsLast = v), (v) => (dsLast = v))
			);
			pin.addEventListener("change", () => {
				dsLast = parseFloat(ds.value);
				rsLast = parseFloat(rs.value);
			});
		}
	}

	// Preset buttons.  Each button applies its bundle of slider values and
	// re-runs.  Any pin-pair whose D/R values differ in the preset gets
	// unchecked first so the second-set side isn't snapped back to match
	// the first.  `enabled: false` hides the button while keeping the bundle.
	function wirePresets(containerId, runNow) {
		const presetsContainer = document.getElementById(containerId);
		if (!presetsContainer || !window.CONFIG.presets) return;
		for (const [name, values] of Object.entries(window.CONFIG.presets)) {
			if (values.enabled === false) continue;
			const btn = document.createElement("button");
			btn.textContent = name;
			btn.style.marginTop = "6px";
			btn.style.background = "#5b6e80";
			btn.addEventListener("click", () => {
				// Uncheck ALL pin-pair checkboxes (not just asymmetric
				// ones) before applying.  Even when a preset's D/R
				// values are equal, leaving the pin checked clobbers
				// the second-applied side: the first side fires the
				// pin propagation (delta = preset D − current D), the
				// partner moves by that delta (e.g. 1 → 1.15), then
				// the second side fires (delta = preset R − new R =
				// 1 − 1.15 = −0.15) and pulls the first side away from
				// the preset value (1 + (−0.15) = 0.85).  Unconditionally
				// unpinning sidesteps the whole tangle.  The user can
				// re-tick whichever pair they want to keep symmetric
				// after the preset loads.
				for (const pair of PINNED_PAIRS) {
					const pin = document.getElementById(pair.pin);
					if (pin) pin.checked = false;
				}
				for (const [id, v] of Object.entries(values)) {
					if (id === "enabled") continue;
					const range = document.getElementById(id);
					if (!range) continue;
					range.value = v;
					const numEl = document.getElementById(id + "_v");
					if (numEl && numEl.tagName === "INPUT") {
						numEl.value = formatVal(id, parseFloat(v));
					}
					range.dispatchEvent(new Event("input", { bubbles: true }));
				}
				updateVoteDisplay();
				runNow();
			});
			presetsContainer.appendChild(btn);
		}
	}

	// Reset every slider to its CONFIG-default value and re-check every
	// pin-pair so the chamber returns to fully-symmetric defaults.
	function resetDefaults(runNow) {
		// Uncheck pins BEFORE applying defaults, then re-check after.
		// A checked pin clobbers the second-applied side via delta
		// propagation when the pair starts out asymmetric (e.g. coming
		// from a preset that loaded different D vs R values).  Same
		// fix as the preset handler in wirePresets above.
		for (const pair of PINNED_PAIRS) {
			const pin = document.getElementById(pair.pin);
			if (pin) pin.checked = false;
		}
		for (const id of SLIDER_IDS) {
			const range = document.getElementById(id);
			if (!range) continue;
			range.value = range.defaultValue;
			const numEl = document.getElementById(id + "_v");
			if (numEl && numEl.tagName === "INPUT") {
				numEl.value = formatVal(id, parseFloat(range.value));
			}
			range.dispatchEvent(new Event("input"));
		}
		// Re-check pins; dispatch 'change' so the pin-pair handler
		// resyncs its dsLast/rsLast tracker against the just-set
		// default values (otherwise the next user drag computes a
		// stale delta).
		for (const pair of PINNED_PAIRS) {
			const pin = document.getElementById(pair.pin);
			if (pin) {
				pin.checked = true;
				pin.dispatchEvent(new Event("change", { bubbles: true }));
			}
		}
		updateVoteDisplay();
		runNow();
	}

	// localStorage key for the raw slider positions (NOT the simulator
	// run data, which lives under `simulator_current_run`).  Persisting
	// the slider values themselves lets the simulator and historical
	// pages share state — drag a slider on one page, navigate to the
	// other, and the same value is already in place.
	const SLIDER_STATE_KEY = "simulator_slider_state";

	function restoreSliderState() {
		let saved;
		try {
			saved = JSON.parse(localStorage.getItem(SLIDER_STATE_KEY) || "null");
		} catch (_) {
			return;
		}
		if (!saved || typeof saved !== "object") return;
		for (const id of SLIDER_IDS) {
			const v = saved[id];
			if (typeof v !== "number" || !isFinite(v)) continue;
			const r = document.getElementById(id);
			if (!r) continue;
			// Clamp into the slider's current [min, max] in case CONFIG
			// has tightened the bounds since the value was cached.
			const lo = parseFloat(r.min),
				hi = parseFloat(r.max);
			r.value = String(Math.max(lo, Math.min(hi, v)));
		}
	}

	function saveSliderState() {
		try {
			const state = {};
			for (const id of SLIDER_IDS) {
				const r = document.getElementById(id);
				if (r) state[id] = parseFloat(r.value);
			}
			localStorage.setItem(SLIDER_STATE_KEY, JSON.stringify(state));
		} catch (_) {
			/* private mode / quota — ignore */
		}
	}

	// Main entry point.  `opts.onRun(params)` is invoked debounced ~120ms
	// after a slider changes, plus once synchronously at the end of bind()
	// so the host page renders its initial state.
	function bind(opts) {
		opts = opts || {};
		applySliderAttributes();
		// Restore slider positions from a prior session/page BEFORE we
		// wire up listeners or compute --val fills.  Sliders' defaultValue
		// stays as the CONFIG default so "Reset to defaults" still goes
		// back to the canonical starting state.
		restoreSliderState();

		let pendingTimer = null;
		const runNow = () => {
			if (pendingTimer) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			saveSliderState();
			if (opts.onRun) opts.onRun(readParams());
		};
		const scheduleRun = () => {
			if (pendingTimer) clearTimeout(pendingTimer);
			// Debounce window, in milliseconds.  Resolution order:
			//   1. The optional `debounceConfigKey` the caller passes to
			//      bind() — e.g. historical.html passes
			//      'historicalSliderDebounceMs' so it gets its own knob.
			//   2. The shared `sliderDebounceMs` field — covers the
			//      simulator page and any caller that doesn't override.
			//   3. Hard fallback of 80 ms if neither is set.
			// Read on every scheduleRun call so live mutation works.
			const C = window.CONFIG?.constants;
			const key = opts.debounceConfigKey;
			const ms = (key && C?.[key] != null)
				? C[key]
				: (C?.sliderDebounceMs ?? 80);
			pendingTimer = setTimeout(() => {
				pendingTimer = null;
				saveSliderState();
				if (opts.onRun) opts.onRun(readParams());
			}, ms);
		};

		for (const id of SLIDER_IDS) wireSlider(id, scheduleRun);

		const vRange = document.getElementById("v");
		if (vRange) vRange.addEventListener("input", updateVoteDisplay);
		updateVoteDisplay();

		wirePinPairs(PINNED_PAIRS, scheduleRun);

		const resetBtn = document.getElementById("reset");
		if (resetBtn) resetBtn.addEventListener("click", () => resetDefaults(runNow));

		wirePresets("presets", runNow);

		runNow();

		return {
			run: runNow,
			scheduleRun,
			readParams,
			resetDefaults: () => resetDefaults(runNow),
		};
	}

	window.CONTROLS = {
		sliderIds: SLIDER_IDS,
		pinnedPairs: PINNED_PAIRS,
		readParams,
		formatVote,
		formatVal,
		updateVoteDisplay,
		bind,
		// Exposed so index.html (which doesn't use bind() because its
		// inline run() does much more than the historical page) can
		// participate in the same cross-page slider-state persistence.
		restoreSliderState,
		saveSliderState,
	};
})();
