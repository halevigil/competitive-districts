#!/usr/bin/env node
// Drive historical.html's window.batchAutoFitYears in headless Chrome via
// puppeteer-core.  Headless tabs aren't subject to Chrome's background-tab
// throttling, so the simulator runs at full CPU speed regardless of what
// the user is doing on screen.
//
// Usage:
//   node tools/batch-fit-headless.js               # nsim=3000, all years
//   node tools/batch-fit-headless.js --nsim 1000   # custom nsim
//   node tools/batch-fit-headless.js --years 2024,2022   # subset
//
// Requires the local static server to be running on PORT (default 8765);
// start it via the .claude/launch.json "static" config or `python3 -m
// http.server 8765` from the repo root.

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8765;
const URL = `http://localhost:${PORT}/historical.html`;

// Use system Chrome to skip the bundled-Chromium download.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { nsim: 3000, years: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--nsim') out.nsim = +args[++i];
    else if (args[i] === '--years') out.years = args[++i].split(',').map(Number);
  }
  return out;
}

async function main() {
  const { nsim, years } = parseArgs();

  if (!fs.existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME}.  Install Chrome or edit CHROME in this script.`);
    process.exit(1);
  }

  console.log(`[headless] launching Chrome (headless)`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Ensure NOTHING about the headless tab is treated as backgrounded —
    // puppeteer's defaults already do this, but be explicit so future
    // Chrome versions don't quietly throttle us.
    args: [
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    // Allow long-running page.evaluate calls (whole batch is one call).
    // Default is 180s; we may run hours.
    protocolTimeout: 24 * 60 * 60 * 1000,
  });

  const page = await browser.newPage();
  // Pipe browser console to our stdout — batchAutoFitYears logs per-year
  // progress via console.log, so this gives a live feed.
  page.on('console', (msg) => {
    const t = msg.type();
    const prefix = t === 'error' ? '[browser:ERR]' : t === 'warning' ? '[browser:WARN]' : '[browser]';
    console.log(`${prefix} ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.error('[browser:PAGEERR]', err.message));

  console.log(`[headless] navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 120000 });

  console.log(`[headless] waiting for page init (batchAutoFitYears + yearStats[2024])`);
  await page.waitForFunction(
    () => typeof window.batchAutoFitYears === 'function' && window.__yearStats && window.__yearStats[2024],
    { timeout: 120000 }
  );

  const rsCfg = await page.evaluate(() => window.CONFIG?.autoFitRandomSearch);
  const quadFlags = await page.evaluate(() => ({
    safe:  !!window.CONFIG?.sliders?.dIntModSafe?.quadratic,
    swing: !!window.CONFIG?.sliders?.dIntModSwing?.quadratic,
    opp:   !!window.CONFIG?.sliders?.dIntModOpp?.quadratic,
  }));
  const incShown = await page.evaluate(() => !!window.CONFIG?.showIncumbencySlider);
  const pviSliders = await page.evaluate(() => !!window.CONFIG?.pviWeightSliders?.enabled);
  console.log(`[headless] config: nsim=${nsim}, randomSearch=`, rsCfg);
  console.log(`[headless] intMod quadratic: safe=${quadFlags.safe}, swing=${quadFlags.swing}, opp=${quadFlags.opp}`);
  console.log(`[headless] flags: showIncumbencySlider=${incShown}, pviWeightSliders=${pviSliders}`);
  console.log(`[headless] starting batch (years=${years || 'all'})`);

  const t0 = Date.now();
  const results = await page.evaluate(
    async (nsimArg, yearsArg) => {
      const opts = { nsim: nsimArg };
      if (yearsArg) opts.years = yearsArg;
      return await window.batchAutoFitYears(opts);
    },
    nsim,
    years
  );
  const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`[headless] batch done in ${elapsedMin} min`);

  // Write raw JSON for programmatic use.
  const jsonPath = path.join(__dirname, 'batch-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`[headless] wrote ${jsonPath}`);

  // Also write a paste-ready preset block matching config.js's existing
  // historicalPresets format.
  const sortedYears = Object.keys(results).sort();
  const blockLines = ['historicalPresets: {'];
  for (const y of sortedYears) {
    const entries = Object.entries(results[y])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    blockLines.push(`\t${y}: { ${entries} },`);
  }
  blockLines.push('},');
  const presetPath = path.join(__dirname, 'historical-presets-block.txt');
  fs.writeFileSync(presetPath, blockLines.join('\n') + '\n');
  console.log(`[headless] wrote ${presetPath} (paste into config.js)`);

  await browser.close();
}

main().catch((e) => {
  console.error('[headless] FAILED:', e);
  process.exit(1);
});
