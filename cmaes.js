// =============================================================================
// SEPARABLE CMA-ES  (sep-CMA-ES, Hansen 2008 / Ros & Hansen 2008)
// -----------------------------------------------------------------------------
// Diagonal-covariance variant of CMA-ES.  Drops the rank-N eigendecomposition
// (the part of full CMA-ES that's painful to implement well in JS without a
// linalg library) at the cost of being unable to learn rotated basins —
// fine for our box-bounded mostly-decoupled candidate-slider space.
//
// Asynchronous: yields to the event loop after each generation so the host
// page stays responsive and the auto-fit "Stop" button still works.
//
// Box-constraint handling is rejection-resample-then-clip: try up to 6
// resamples per offspring, then clip the survivor and back-fill its z so
// the covariance update sees the actual move that landed inside the box.
//
// Strategy parameters follow Hansen's defaults.  The `sepBoost = (n+2)/3`
// learning-rate multiplier on c1 / cMu is what distinguishes sep-CMA-ES
// from a naive diagonal restriction of full CMA-ES — it compensates for
// the lost off-diagonal information.
//
// Usage:
//   const result = await cmaesMinimize({
//     x0:        [...],     // initial mean (length n)
//     sigma0:    0.3,       // initial step size (in INPUT UNITS, after
//                           // any bounds normalisation you do before calling)
//     bounds:    [{lo, hi}, ...],   // per-dim, length n
//     evalFn:    (x) => objective_value,    // sync or async
//     maxEvals:  500,       // hard budget cap
//     shouldStop:() => bool,// optional early-cancel poll
//     onProgress:(info) => void,  // optional, called each generation
//   });
//   // → { x: bestX (Float64Array), obj: bestObj, evals: int }
//
// Exposed as window.cmaesMinimize.  No build step.
// =============================================================================

(function () {
	function gaussian() {
		// Box-Muller; uses Math.random independently of the caller's PRNG so
		// CMA-ES sampling doesn't consume the seeded model RNG that's
		// reserved for common random numbers in evalFn.
		let u = 0,
			v = 0;
		while (u === 0) u = Math.random();
		while (v === 0) v = Math.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	async function cmaesMinimize(opts) {
		const {
			x0,
			sigma0,
			bounds,
			evalFn,
			maxEvals,
			shouldStop = () => false,
			onProgress = null,
		} = opts;
		const n = x0.length;
		if (bounds.length !== n) {
			throw new Error(`cmaes: bounds length ${bounds.length} != x0 length ${n}`);
		}

		// --- Strategy parameters (Hansen defaults) -----------------------------
		const lambda = Math.max(4 + Math.floor(3 * Math.log(n)), 5);
		const mu = Math.floor(lambda / 2);
		const wRaw = [];
		let wsum = 0;
		for (let i = 0; i < mu; i++) {
			const wi = Math.log(mu + 1) - Math.log(i + 1);
			wRaw.push(wi);
			wsum += wi;
		}
		const w = wRaw.map((x) => x / wsum);
		let muEff = 0;
		for (const wi of w) muEff += wi * wi;
		muEff = 1 / muEff;
		const cSig = (muEff + 2) / (n + muEff + 5);
		const dSig =
			1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cSig;
		const cC = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
		const c1Full = 2 / ((n + 1.3) ** 2 + muEff);
		const cMuFull = Math.min(
			1 - c1Full,
			(2 * (muEff - 2 + 1 / muEff)) / ((n + 2) ** 2 + muEff),
		);
		// sep-CMA-ES learning-rate boost on c1 and cMu (Ros & Hansen 2008).
		const sepBoost = (n + 2) / 3;
		const c1 = c1Full * sepBoost;
		const cMu = cMuFull * sepBoost;
		// E[||N(0,I)||] approximation.
		const expectedNorm = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

		// --- State -------------------------------------------------------------
		const m = Float64Array.from(x0);
		let sigma = sigma0;
		const C = new Float64Array(n).fill(1);
		const pSig = new Float64Array(n);
		const pC = new Float64Array(n);
		let bestX = Float64Array.from(x0);
		let bestObj = Infinity;
		let evals = 0;
		let gen = 0;

		// --- Sampling helper (rejection-resample + clip) ----------------------
		function sampleOffspring() {
			const z = new Float64Array(n);
			const y = new Float64Array(n);
			const xCand = new Float64Array(n);
			let inBounds = false;
			for (let attempts = 0; attempts < 6 && !inBounds; attempts++) {
				let ok = true;
				for (let i = 0; i < n; i++) {
					z[i] = gaussian();
					y[i] = Math.sqrt(C[i]) * z[i];
					xCand[i] = m[i] + sigma * y[i];
					if (xCand[i] < bounds[i].lo || xCand[i] > bounds[i].hi) ok = false;
				}
				if (ok) inBounds = true;
			}
			if (!inBounds) {
				for (let i = 0; i < n; i++) {
					if (xCand[i] < bounds[i].lo) xCand[i] = bounds[i].lo;
					if (xCand[i] > bounds[i].hi) xCand[i] = bounds[i].hi;
					y[i] = (xCand[i] - m[i]) / sigma;
					const sq = Math.sqrt(C[i]);
					z[i] = sq > 0 ? y[i] / sq : 0;
				}
			}
			return { x: xCand, y, z };
		}

		// --- Main loop ---------------------------------------------------------
		while (evals < maxEvals && !shouldStop()) {
			gen++;
			const samples = [];
			for (let k = 0; k < lambda; k++) {
				if (evals >= maxEvals || shouldStop()) break;
				const s = sampleOffspring();
				const obj = await Promise.resolve(evalFn(s.x));
				evals++;
				s.obj = obj;
				samples.push(s);
				if (obj < bestObj) {
					bestObj = obj;
					bestX = Float64Array.from(s.x);
				}
			}
			if (samples.length === 0) break;
			samples.sort((a, b) => a.obj - b.obj);

			const M = Math.min(mu, samples.length);
			let wActive = 0;
			for (let i = 0; i < M; i++) wActive += w[i];

			// Weighted means of y and z over best M.
			const yMean = new Float64Array(n);
			const zMean = new Float64Array(n);
			for (let i = 0; i < M; i++) {
				const wi = w[i] / wActive;
				const s = samples[i];
				for (let d = 0; d < n; d++) {
					yMean[d] += wi * s.y[d];
					zMean[d] += wi * s.z[d];
				}
			}

			// Update mean (with box-clip).
			for (let d = 0; d < n; d++) {
				m[d] += sigma * yMean[d];
				if (m[d] < bounds[d].lo) m[d] = bounds[d].lo;
				if (m[d] > bounds[d].hi) m[d] = bounds[d].hi;
			}

			// Update sigma evolution path.
			const pSigCoef = Math.sqrt(cSig * (2 - cSig) * muEff);
			let pSigNorm2 = 0;
			for (let d = 0; d < n; d++) {
				pSig[d] = (1 - cSig) * pSig[d] + pSigCoef * zMean[d];
				pSigNorm2 += pSig[d] * pSig[d];
			}
			const pSigNorm = Math.sqrt(pSigNorm2);

			// Heaviside step for stalled sigma path.
			const hSig =
				pSigNorm /
					Math.sqrt(1 - Math.pow(1 - cSig, 2 * gen)) /
					expectedNorm <
				1.4 + 2 / (n + 1)
					? 1
					: 0;

			// Update C-evolution path.
			const pCCoef = Math.sqrt(cC * (2 - cC) * muEff);
			for (let d = 0; d < n; d++) {
				pC[d] = (1 - cC) * pC[d] + hSig * pCCoef * yMean[d];
			}

			// Update covariance (rank-1 + rank-mu, diagonal).
			const cMuTerm = new Float64Array(n);
			for (let i = 0; i < M; i++) {
				const wi = w[i] / wActive;
				const s = samples[i];
				for (let d = 0; d < n; d++) {
					cMuTerm[d] += wi * s.y[d] * s.y[d];
				}
			}
			for (let d = 0; d < n; d++) {
				const c1Term =
					c1 * (pC[d] * pC[d] + (1 - hSig) * cC * (2 - cC) * C[d]);
				C[d] = (1 - c1 - cMu) * C[d] + c1Term + cMu * cMuTerm[d];
				if (C[d] < 1e-12) C[d] = 1e-12;
			}

			// Update sigma.
			sigma *= Math.exp((cSig / dSig) * (pSigNorm / expectedNorm - 1));
			// Defensive clamp — pathological objectives can blow up sigma.
			sigma = Math.max(1e-10, Math.min(1e10, sigma));

			if (onProgress) onProgress({ gen, evals, lambda, bestObj, sigma });
			await new Promise((r) => setTimeout(r, 0));
		}

		return { x: bestX, obj: bestObj, evals, gen };
	}

	if (typeof window !== 'undefined') {
		window.cmaesMinimize = cmaesMinimize;
	}
})();
