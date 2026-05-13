// =============================================================================
// HISTORICAL VIEW CONFIG
// -----------------------------------------------------------------------------
// Controls for historical.html — the page that renders empirical district
// presidential-margin histograms for 2008, 2012, 2016, 2020, 2024.
// =============================================================================
window.HISTORICAL_CONFIG = {
	// Histogram bin width in percentage points.  The underlying data is at
	// 2-pp resolution, so any binSize ≥ 2 works exactly.  binSize values
	// smaller than 2 are clamped up to 2 (sub-2pp resolution isn't available
	// in the source CSVs we ingested).
	//
	// Common choices:
	//   binSize: 2  → finest available, ~100 bars per chart
	//   binSize: 5  → matches the simulator's default district histogram
	//   binSize: 10 → coarser, easier to see distribution shape
	binSize: 4,
};
