# Competitive Districts

Interactive Monte Carlo simulator of a 435-seat legislative chamber: stochastic
candidate ideology, district-level elections, and the resulting distribution
of the **median representative's** ideology and party.

## Files

- **[`index.html`](index.html)** — accessible version with seven plain-English
  knobs and most numeric readouts hidden. This is the default page served by
  most static hosts (Netlify, Fly, GitHub Pages). Backing parameters are
  derived from the slider values via the linear couplings documented in
  `simple_model.tex`.
- **[`full.html`](full.html)** — full applet, every parameter exposed
  (district distribution, candidate noise, β coefficients, election noise,
  popular vote shift). Three live charts: median-rep histogram, single-chamber
  scatter, and pooled district-partisanship histogram.
- **[`simple_model.tex`](simple_model.tex)** — technical reference for the
  default (simplified) applet: the full mathematical model, the fixed
  constants, and the slider → parameter map. Updated whenever the model
  behavior changes.

## Running

Both HTML files are self-contained and fetch [Plotly.js](https://plotly.com/javascript/)
from a CDN — just open them in a browser. No build step.

## Model in one paragraph

Districts are placed deterministically at the quantiles of a truncated
Gaussian on `(0, 100]`, mirrored to the negative half. For each district a
Democratic and Republican candidate ideology is drawn (Gaussian noise plus
a `β · log(100/|d|)` "moderation in competitive districts" term). The
sigmoid `P(R wins) = σ((v + d − w_mod·(c^D + c^R)) / σ_noise)` decides who
wins, and the chamber's median rep is the rank-`m` ideology after sorting.
The applet runs the simulation many times and visualizes the empirical
distribution of the median rep's ideology.

See `simple_model.tex` for the full equations.
