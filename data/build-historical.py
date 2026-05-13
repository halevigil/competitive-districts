#!/usr/bin/env python3
# =============================================================================
# Build clean per-district House + Presidential / PVI CSVs for historical.html.
# Reads:
#   - 538-house-raw.csv                              (House results)
#   - downballot-2024-pres-by-cd.csv                 (2020 & 2024 pres in 2024-cycle districts)
#   - dailykos-2008-2020-pres-by-cd-2020-cycle.csv   (2008/2012/2016/2020 pres in 2020-cycle districts)
# Writes:
#   - house-winners.csv         (cycle, state, district, winner_party)
#   - house-margins.csv         (cycle, state, district, margin, winner_party)
#   - pres-by-cd.csv            (cycle, district_cycle, state, district, margin)
#   - pvi-by-cd.csv             (cycle, district_cycle, state, district, pvi)
#
# Run from this directory:    python3 build-historical.py
# =============================================================================
import csv
from collections import defaultdict

# Presidential years use the per-district presidential margin as the lean
# axis on historical.html; midterm years use a Cook-PVI-style metric
# computed below from the two most recent presidential cycles.
PRES_YEARS    = (2008, 2012, 2016, 2020, 2024)
MIDTERM_YEARS = (2010, 2014, 2018, 2022)
YEARS         = tuple(sorted(PRES_YEARS + MIDTERM_YEARS))

# National two-party presidential margin per cycle (R% − D%, percentage
# points).  Used as the "anchor" in the PVI calculation:
#     PVI(district, year) = (2·R1 + R2) / 3   −   (2·N1 + N2) / 3
# where R1 / R2 are the district's last-two presidential margins (most
# recent weighted 2×) and N1 / N2 are the national margins for those
# same years.  Cook uses a 3-to-1 weighting these days; we use 2-to-1
# (matches Cook's older methodology and reads cleaner here).
NATIONAL_PRES_MARGIN = {
    2008:  -7.27,  # Obama beat McCain by 7.27 pp
    2012:  -3.86,  # Obama beat Romney by 3.86 pp
    2016:  -2.10,  # Clinton beat Trump by 2.10 pp in popular vote
    2020:  -4.45,  # Biden beat Trump by 4.45 pp
    2024:  +1.48,  # Trump beat Harris by 1.48 pp
}

# Per-midterm: (district_cycle, [(year, weight), …]).  Weights default
# to 2 for the most recent pres cycle and 1 for the previous one.  Where
# only one cycle is available in the right district lines, we fall back
# to single-cycle (the 2-to-1 collapses to 1-to-0).
PVI_BACKING = {
    2010: ("2020", [(2008, 1)]),                  # no 2004 data; single-cycle
    2014: ("2020", [(2012, 2), (2008, 1)]),
    2018: ("2020", [(2016, 2), (2012, 1)]),
    2022: ("2024", [(2020, 1)]),                  # no 2016 in 2024-cycle lines
}

# -----------------------------------------------------------------------------
# House winners — per district per year, picking the candidate with the most
# votes in the general election.  Skips primaries / specials / runoffs.
# -----------------------------------------------------------------------------
house_rows = defaultdict(list)  # (year, state, district) -> [(votes, party), ...]
with open("538-house-raw.csv", newline="") as f:
    rdr = csv.DictReader(f)
    for row in rdr:
        if row["office_name"] != "U.S. House":
            continue
        if row["stage"] != "general":
            continue
        if row["special"].lower() == "true":
            continue
        try:
            year = int(row["cycle"])
        except ValueError:
            continue
        if year not in YEARS:
            continue
        try:
            votes = int(row["votes"]) if row["votes"] else 0
        except ValueError:
            votes = 0
        state = row["state_abbrev"]
        # office_seat_name like "District 7" or "At-Large"
        seat = row["office_seat_name"] or "At-Large"
        if seat.startswith("District "):
            district = seat[len("District "):].zfill(2)
        elif seat.lower() in ("at-large", "at large"):
            district = "AL"
        else:
            district = seat
        # Party normalised to D / R / O.
        bp = (row["ballot_party"] or row["party"] or "").upper()
        if "DEM" in bp or bp == "D":
            party = "D"
        elif "REP" in bp or bp == "R":
            party = "R"
        else:
            party = "O"
        house_rows[(year, state, district)].append((votes, party))

with open("house-winners.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "state", "district", "winner_party"])
    for (year, state, district), candidates in sorted(house_rows.items()):
        if not candidates:
            continue
        # Sum votes by party (handles fusion / multiple lines per candidate).
        by_party = defaultdict(int)
        for votes, party in candidates:
            by_party[party] += votes
        winner = max(by_party.items(), key=lambda kv: kv[1])[0]
        w.writerow([year, state, district, winner])
print("house-winners.csv written")

# -----------------------------------------------------------------------------
# Per-district House election MARGIN — same source as house-winners.csv but
# expressed as (R% − D%) in percentage points.  Districts where one of D / R
# didn't run (or got rounded to zero votes) are stored as ±100 so the
# histogram on the historical page can still bin them.  Used for the
# right-column "Distribution of Election Margins" chart on historical.html.
# -----------------------------------------------------------------------------
with open("house-margins.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "state", "district", "margin", "winner_party"])
    for (year, state, district), candidates in sorted(house_rows.items()):
        if not candidates:
            continue
        by_party = defaultdict(int)
        for votes, party in candidates:
            by_party[party] += votes
        total = sum(by_party.values())
        if total <= 0:
            continue
        d_pct = 100.0 * by_party.get("D", 0) / total
        r_pct = 100.0 * by_party.get("R", 0) / total
        margin = round(r_pct - d_pct, 2)
        winner = max(by_party.items(), key=lambda kv: kv[1])[0]
        w.writerow([year, state, district, margin, winner])
print("house-margins.csv written")

# -----------------------------------------------------------------------------
# Presidential margin per CD, from the two Daily Kos / Downballot sheets.
# Output schema:
#   cycle           — election year (e.g. 2024)
#   district_cycle  — which redistricting cycle's district lines were used
#                     ("2020" = post-2010 lines, "2024" = post-2020 lines).
#                     Lets the renderer match cycles up.
#   state, district — e.g. CA, 12
#   margin          — R% - D%, in percentage points
# -----------------------------------------------------------------------------
def parse_pct(s):
    s = s.strip().rstrip("%")
    return float(s) if s else None

def split_cd(token):
    # Accepts "AK-AL" or "CA-12"; returns ("CA", "12") or ("AK", "01").
    # 538 stores at-large states as "District 1" → "01"; we collapse the
    # Daily Kos / Downballot "AL" suffix to "01" so the join works.
    state, _, district = token.partition("-")
    if district.upper() == "AL":
        return state, "01"
    return state, district.zfill(2) if district.isdigit() else district

pres_out = []

# --- Daily Kos 2008-2020 sheet (in 2020-cycle districts) ---
# Format (after stripping header rows):
#   row[0] = "AK-AL"
#   row[3..4] = 2020 Biden, 2020 Trump
#   row[5..6] = 2016 Clinton, 2016 Trump
#   row[7..8] = 2012 Obama, 2012 Romney
#   row[9..10] = 2008 Obama, 2008 McCain
with open("dailykos-2008-2020-pres-by-cd-2020-cycle.csv", newline="") as f:
    rdr = list(csv.reader(f))
# First two rows are header annotations (year band + column names).
for row in rdr[2:]:
    if not row or not row[0] or "-" not in row[0]:
        continue
    state, district = split_cd(row[0])
    pairs = [
        (2020, 3, 4),
        (2016, 5, 6),
        (2012, 7, 8),
        (2008, 9, 10),
    ]
    for cycle, di, ri in pairs:
        try:
            d = parse_pct(row[di])
            r = parse_pct(row[ri])
        except (ValueError, IndexError):
            continue
        if d is None or r is None:
            continue
        pres_out.append([cycle, "2020", state, district, round(r - d, 2)])

# --- Downballot 2024 sheet (in 2024-cycle districts) ---
# Top three rows are headers.  Layout (post-headers):
#   row[0]  = "AK-AL"
#   row[3]/[4]   = 2024 Harris / Trump raw votes
#   row[6]/[7]   = 2024 Harris % / Trump %
#   row[10]/[11] = 2020 Biden / Trump raw votes
#   row[13]/[14] = 2020 Biden % / Trump %
with open("downballot-2024-pres-by-cd.csv", newline="") as f:
    rdr = list(csv.reader(f))
for row in rdr[3:]:
    if not row or not row[0] or "-" not in row[0]:
        continue
    state, district = split_cd(row[0])
    pairs = [
        (2024, 6, 7),
        (2020, 13, 14),
    ]
    for cycle, di, ri in pairs:
        try:
            d = parse_pct(row[di])
            r = parse_pct(row[ri])
        except (ValueError, IndexError):
            continue
        if d is None or r is None:
            continue
        pres_out.append([cycle, "2024", state, district, round(r - d, 2)])

with open("pres-by-cd.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "district_cycle", "state", "district", "margin"])
    for r in sorted(pres_out):
        w.writerow(r)
print(f"pres-by-cd.csv written ({len(pres_out)} rows)")

# -----------------------------------------------------------------------------
# PVI per district per midterm year (Cook-style, 2-to-1 weighted):
#   PVI = Σ(w·district_margin) / Σw  −  Σ(w·national_margin) / Σw
# over the backing presidential cycles in PVI_BACKING.  Most recent
# cycle gets weight 2, the previous gets weight 1.  Reported in
# (R% − D%) percentage-point units, same axis as pres-by-cd.margin —
# positive = R-leaning vs the country, negative = D-leaning.
# -----------------------------------------------------------------------------
# Index pres_out by (cycle, district_cycle) → {(state, district): margin}.
pres_by_cycle = defaultdict(dict)
for cycle, district_cycle, state, district, margin in pres_out:
    pres_by_cycle[(cycle, district_cycle)][(state, district)] = margin

pvi_out = []
for midterm, (district_cycle, weighted_years) in PVI_BACKING.items():
    total_w = sum(w for (_, w) in weighted_years)
    nat_weighted = sum(NATIONAL_PRES_MARGIN[y] * w for (y, w) in weighted_years)
    nat_avg = nat_weighted / total_w
    # Districts present in EVERY backing pres cycle (intersection).
    district_sets = [
        set(pres_by_cycle[(py, district_cycle)].keys())
        for (py, _) in weighted_years
    ]
    common = set.intersection(*district_sets) if district_sets else set()
    for (state, district) in sorted(common):
        district_weighted = sum(
            pres_by_cycle[(py, district_cycle)][(state, district)] * w
            for (py, w) in weighted_years
        )
        district_avg = district_weighted / total_w
        pvi = round(district_avg - nat_avg, 2)
        pvi_out.append([midterm, district_cycle, state, district, pvi])

with open("pvi-by-cd.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "district_cycle", "state", "district", "pvi"])
    for r in pvi_out:
        w.writerow(r)
print(f"pvi-by-cd.csv written ({len(pvi_out)} rows)")
