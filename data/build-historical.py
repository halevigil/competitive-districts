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
PRES_YEARS    = (1992, 1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024)
MIDTERM_YEARS = (1994, 1998, 2002, 2006, 2010, 2014, 2018, 2022)
YEARS         = tuple(sorted(PRES_YEARS + MIDTERM_YEARS))

# National two-party presidential margin per cycle (R% − D%, percentage
# points).  Used as the "anchor" in the PVI calculation:
#     PVI(district, year) = (2·R1 + R2) / 3   −   (2·N1 + N2) / 3
# where R1 / R2 are the district's last-two presidential margins (most
# recent weighted 2×) and N1 / N2 are the national margins for those
# same years.  Cook uses a 3-to-1 weighting these days; we use 2-to-1
# (matches Cook's older methodology and reads cleaner here).
NATIONAL_PRES_MARGIN = {
    1988:  +7.72,  # Bush beat Dukakis by 7.72 pp
    1992:  -5.56,  # Clinton beat Bush by 5.56 pp (Perot got 18.9%)
    1996:  -8.51,  # Clinton beat Dole by 8.51 pp (Perot got 8.4%)
    2000:  -0.51,  # Gore beat Bush by 0.51 pp in popular vote (lost EC)
    2004:  +2.46,  # Bush beat Kerry by 2.46 pp
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
    # 1992-cycle lines (1992-2000 elections).  1988 was held in 1980s-cycle
    # lines, so 1994's PVI is single-cycle (just 1992); 1998 gets the full
    # 2-to-1 weighting.
    1994: ("2000", [(1992, 1)]),
    1998: ("2000", [(1996, 2), (1992, 1)]),
    # 2002-cycle lines (2002-2010 elections).  1996 isn't available in
    # 2002-cycle lines, so 2002's PVI is single-cycle (just 2000).
    2002: ("2008", [(2000, 1)]),
    2006: ("2008", [(2004, 2), (2000, 1)]),
    2010: ("2008", [(2008, 2), (2004, 1)]),
    # 2012-cycle lines (2012-2020 elections).
    2014: ("2020", [(2012, 2), (2008, 1)]),
    2018: ("2020", [(2016, 2), (2012, 1)]),
    # 2022-cycle lines (single-cycle: no 2016 in 2022-cycle lines).
    2022: ("2022", [(2020, 1)]),
}

# -----------------------------------------------------------------------------
# House winners + margins — per district per cycle, picking the candidate
# with the most votes in the general election.
#
# Sources (merged into one normalised structure before tallying):
#   - 538 raw           — 1998-2024 (its earliest cycle is 1998)
#   - MEDSL 1976-2018   — 1992-1996 fill-in for the years 538 doesn't cover
#
# Two real-world wrinkles drive the slightly-elaborate logic below.
#
# (A) Stage fallback.  Most cycles label the November general as
#     stage='general' (538) or stage='gen' (MEDSL).  Exceptions are
#     Louisiana from 1998 on (stage='jungle primary' + sometimes a
#     December 'runoff'), and the two court-ordered mid-decade Texas
#     redraws — TX 1996 and TX 2006 — that ran a similar jungle-style
#     November contest with a runoff in a few districts.  For each
#     district we keep results from the *highest-priority stage that
#     exists* (0 = normal general, 1 = runoff, 2 = jungle primary /
#     court-ordered "primary" stage that functioned as the general).
#     This recovers every LA seat and the 13+5 TX seats that fall out
#     of a naive general-only filter.
#
# (B) Candidate-aware fusion handling.  New York runs cross-endorsed
#     candidates on multiple ballot lines (e.g. James Walsh 2004 on
#     REP + CRV + IDP) and a naive party-line sum miscredits the
#     non-major-party rows as 'O' — sometimes flipping the apparent
#     winner.  Aggregating per-candidate (summing all of one person's
#     ballot lines, then asking what their primary D/R/I tag was)
#     fixes the fusion case and also lets us drop "scatter" / NA /
#     write-in pool rows that aren't real candidates.
# -----------------------------------------------------------------------------

# Three known Independents who held a seat and consistently caucused
# with one of the two major parties.  We recode their winning row to
# the caucus party so the historical chart's "blue = D-won, red = R-won"
# colouring reflects who would vote for Speaker, not the ballot label.
INDEPENDENT_CAUCUS = {
    # Bernie Sanders (VT-AL) ran as I every cycle 1990-2006 and caucused
    # with the Democrats throughout his House tenure.
    ("VT", "01", 1992): "D",
    ("VT", "01", 1994): "D",
    ("VT", "01", 1996): "D",
    ("VT", "01", 1998): "D",
    ("VT", "01", 2000): "D",
    ("VT", "01", 2002): "D",
    ("VT", "01", 2004): "D",
    ("VT", "01", 2006): "D",
    # Jo Ann Emerson won MO-08 1996 as an Independent (her R husband died
    # mid-cycle and she missed the R primary deadline); seated with R.
    ("MO", "08", 1996): "R",
    # Virgil Goode left the Democrats mid-term and ran I for VA-05 2000;
    # caucused with R that Congress, formally switched to R in 2002.
    ("VA", "05", 2000): "R",
}

# The 50 states.  Non-voting House delegates (DC, PR, GU, VI, AS, MP) show up
# in the 538 raw file but aren't part of the 435-seat chamber, so we skip
# them to keep the join with the 435-district pres-by-CD universe clean.
VOTING_STATES = frozenset({
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV",
    "NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
    "TX","UT","VT","VA","WA","WV","WI","WY",
})

def _norm_district(d):
    d = str(d).strip()
    if d in ("", "0", "00") or d.upper() in ("AL", "AT-LARGE"):
        return "01"
    return d.zfill(2) if d.isdigit() else d

def _party_from(*tokens):
    """Map any of (ballot_party, party) free-text labels into D / R / O."""
    blob = " ".join((t or "") for t in tokens).upper()
    if "DEM" in blob or " D " in f" {blob} ":
        return "D"
    if "REP" in blob or " R " in f" {blob} ":
        return "R"
    return "O"

# Strings the source files use as a non-candidate placeholder.  We drop these
# rows because they pool blank / spoiled / write-in / "other" ballots and the
# names don't represent a real candidate.
_NOT_A_CANDIDATE = {"", "scatter", "scattering", "na", "n/a", "other", "others",
                    "write-in", "writein", "write in", "blank", "void"}

def _is_real_candidate(name):
    return (name or "").strip().lower() not in _NOT_A_CANDIDATE

# Stage priority: 0 = normal general (preferred when present), 1 = runoff,
# 2 = jungle primary / court-ordered "primary" that functioned as general.
def _538_stage_priority(stage, runoff_flag=False):
    s = (stage or "").lower()
    if s == "general":        return 1 if runoff_flag else 0
    if s == "runoff":         return 1
    if s == "jungle primary": return 2
    return None

def _medsl_stage_priority(stage, runoff):
    if stage == "gen":
        return 1 if runoff == "TRUE" else 0
    if stage == "pri":
        return 2
    return None

# All ingested candidate rows land here, keyed by district + stage_priority.
# Value: list of (candidate_name, party_code, votes).  We later pick the
# lowest stage_priority that has data for each district.
by_district_stage = defaultdict(lambda: defaultdict(list))

# --- 538 raw (1998-2024) ------------------------------------------------------
with open("538-house-raw.csv", newline="") as f:
    rdr = csv.DictReader(f)
    for row in rdr:
        if row["office_name"] != "U.S. House":
            continue
        if row["special"].lower() == "true":
            # We *do* keep the TX-2006 / TX-1996 special-flagged rows further
            # down by source-specific logic, but 538 generally only flags true
            # special elections this way and we don't want those to shadow the
            # cycle's regular general (e.g. a March 2018 PA-18 special would
            # otherwise outrank the November cycle entry for the same seat).
            continue
        try:
            year = int(row["cycle"])
        except ValueError:
            continue
        if year not in YEARS:
            continue
        prio = _538_stage_priority(row["stage"])
        if prio is None:
            continue
        try:
            votes = int(row["votes"]) if row["votes"] else 0
        except ValueError:
            votes = 0
        state = row["state_abbrev"]
        if state not in VOTING_STATES:
            continue
        seat = row["office_seat_name"] or "At-Large"
        if seat.startswith("District "):
            district = seat[len("District "):].zfill(2)
        elif seat.lower() in ("at-large", "at large"):
            district = "01"
        else:
            district = seat.zfill(2) if seat.isdigit() else seat
        cand = (row.get("candidate_name") or "").strip()
        party = _party_from(row.get("ballot_party"), row.get("party"))
        by_district_stage[(year, state, district)][prio].append((cand, party, votes))

# Pull the TX-2006 court-ordered districts from 538's special=TRUE rows.
# Those 5 seats (TX-15/21/23/25/28) have no normal-general row anywhere in
# the dataset — the November vote is stage='jungle primary' special=TRUE and
# the runoff (TX-23 only) is stage='runoff' special=TRUE.  Treat them the
# same way as the cycle's regular jungle-primary / runoff for the purpose of
# stage_priority so the rest of the pipeline picks them up.
TX2006_REDRAW = {"15", "21", "23", "25", "28"}
with open("538-house-raw.csv", newline="") as f:
    rdr = csv.DictReader(f)
    for row in rdr:
        if row["office_name"] != "U.S. House":
            continue
        if row["cycle"] != "2006" or row["state_abbrev"] != "TX":
            continue
        if row["special"].lower() != "true":
            continue
        seat = row["office_seat_name"] or ""
        if not seat.startswith("District "):
            continue
        district_raw = seat[len("District "):]
        if district_raw not in TX2006_REDRAW:
            continue
        prio = _538_stage_priority(row["stage"])
        if prio is None:
            continue
        try:
            votes = int(row["votes"]) if row["votes"] else 0
        except ValueError:
            votes = 0
        cand = (row.get("candidate_name") or "").strip()
        party = _party_from(row.get("ballot_party"), row.get("party"))
        district = district_raw.zfill(2)
        by_district_stage[(2006, "TX", district)][prio].append((cand, party, votes))

# --- MEDSL 1976-2018 (1992 / 1994 / 1996) -------------------------------------
MEDSL_YEARS = (1992, 1994, 1996)
with open("medsl-1976-2018-house.csv", newline="", encoding="latin-1") as f:
    rdr = csv.DictReader(f)
    for row in rdr:
        try:
            year = int(row["year"])
        except ValueError:
            continue
        if year not in MEDSL_YEARS:
            continue
        if row.get("writein", "").upper() == "TRUE":
            continue
        prio = _medsl_stage_priority(row["stage"], row.get("runoff", ""))
        if prio is None:
            continue
        try:
            votes = int(row["candidatevotes"]) if row["candidatevotes"] else 0
        except ValueError:
            votes = 0
        state = row["state_po"]
        district = _norm_district(row["district"])
        cand = (row.get("candidate") or "").strip()
        party = _party_from(row.get("party"))
        by_district_stage[(year, state, district)][prio].append((cand, party, votes))

# Now collapse each district to one stage's worth of candidate-grouped rows
# and write house-winners + house-margins.
def _aggregate_candidates(rows):
    """Group candidate-line rows into per-candidate totals.

    Returns a dict candidate_name -> (total_votes, party_code), and a
    "non-candidate" tally for 'scatter'/blank rows we exclude from the
    candidate winner pick but still want for margin denominators.

    party_code is D if any of the candidate's rows is D, else R if any is
    R, else O — the usual fusion-ticket cross-endorsement.
    """
    per_cand_votes  = defaultdict(int)
    per_cand_parties = defaultdict(set)
    non_cand_by_party = defaultdict(int)
    for cand, party, votes in rows:
        if _is_real_candidate(cand):
            per_cand_votes[cand]   += votes
            per_cand_parties[cand].add(party)
        else:
            non_cand_by_party[party] += votes
    def party_pick(s):
        if "D" in s: return "D"
        if "R" in s: return "R"
        return "O"
    cand_table = {c: (per_cand_votes[c], party_pick(per_cand_parties[c]))
                  for c in per_cand_votes}
    return cand_table, non_cand_by_party

with open("house-winners.csv", "w", newline="") as w_winners, \
     open("house-margins.csv", "w", newline="") as w_margins:
    ww = csv.writer(w_winners);  ww.writerow(["cycle","state","district","winner_party"])
    wm = csv.writer(w_margins);  wm.writerow(["cycle","state","district","margin","winner_party"])
    for (year, state, district), by_stage in sorted(by_district_stage.items()):
        # Use the lowest priority (= preferred) stage that has any rows.
        rows = None
        for prio in (0, 1, 2):
            if by_stage.get(prio):
                rows = by_stage[prio]; break
        if not rows:
            continue
        cand_table, non_cand = _aggregate_candidates(rows)
        if not cand_table:
            continue
        # Winner = candidate with most total votes.  Then map I-caucused-with-X
        # cases to the caucus party for the chart-colour purposes.
        winner_name, (_, winner_party) = max(cand_table.items(),
                                             key=lambda kv: kv[1][0])
        winner_party = INDEPENDENT_CAUCUS.get((state, district, year), winner_party)
        ww.writerow([year, state, district, winner_party])
        # Margin: sum candidate totals by candidate's primary party plus the
        # non-candidate "scatter" pool by its source label.  Denominator is
        # everything that hit the ballot in that stage.
        by_party = defaultdict(int)
        for cname, (votes, party) in cand_table.items():
            by_party[party] += votes
        for party, votes in non_cand.items():
            by_party[party] += votes
        total = sum(by_party.values())
        d_pct = 100.0 * by_party.get("D", 0) / total if total > 0 else 0.0
        r_pct = 100.0 * by_party.get("R", 0) / total if total > 0 else 0.0
        # Effectively-uncontested detection: a race counts as
        # uncontested for our W² fitting if one major party got less
        # than 5% of the recorded vote.  Three real-world cases:
        #   1. No-vote-recorded unopposed (total=0).  538's pre-2010
        #      FL / OK rows tag these unopposed='true' with empty
        #      votes cells.
        #   2. Truly empty side: one party got 0% but third-parties /
        #      independents got the rest (e.g. NC-3 2024 had R 77%,
        #      D 0%, third-party 23%).  The 77% margin is meaningless
        #      as a D-vs-R result.
        #   3. Token opposition (e.g. AL-4 2024: R 98.79%, D 1.21%).
        #      The "opposition" was a write-in / ballot artifact that
        #      tells us nothing about D-vs-R competition.
        # All three get the ±100 sentinel based on who won, so the
        # downstream W² filter (Math.abs(margin) < 99.5 in
        # historical.html) excludes them from the empirical PIT.
        # The 5% threshold matches political-science convention for
        # "contested" House races.
        EFFECTIVELY_UNCONTESTED_THRESHOLD = 5.0
        is_uncontested = (
            total <= 0
            or d_pct < EFFECTIVELY_UNCONTESTED_THRESHOLD
            or r_pct < EFFECTIVELY_UNCONTESTED_THRESHOLD
        )
        if is_uncontested:
            margin = +100.0 if winner_party == "R" else (-100.0 if winner_party == "D" else 0.0)
        else:
            margin = round(r_pct - d_pct, 2)
        wm.writerow([year, state, district, margin, winner_party])
print("house-winners.csv written")
print("house-margins.csv written")

# -----------------------------------------------------------------------------
# Presidential margin per CD, from several Daily Kos / Downballot sheets.
# Output schema:
#   cycle           — presidential election year (e.g. 2024)
#   district_cycle  — which redistricting cycle's district lines were used:
#                       "2008" = 2002-cycle lines (2002–2010 elections)
#                       "2020" = 2012-cycle lines (2012–2020 elections)
#                       "2022" = 2022-cycle lines (2022 election as drawn)
#                       "2024" = 2024-cycle lines (2024 election; minor
#                                differences from 2022-cycle in NC, NY, AL, LA)
#                     Lets the renderer match district lines up with the
#                     election year that used them.
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

# --- Daily Kos 2000/2004/2008 in 2002-cycle (2002-2010) districts ---
#   row[0]: CD ("AL-01", "AK-AL")
#   row[3]/[4]: 2008 D% / R%
#   row[5]/[6]: 2004 D% / R%
#   row[7]/[8]: 2000 D% / R%
with open("dailykos-2000-2008-pres-by-cd-2008-cycle.csv", newline="") as f:
    rdr = list(csv.reader(f))
for row in rdr[2:]:  # skip the 2 header rows
    if not row or not row[0] or "-" not in row[0]:
        continue
    state, district = split_cd(row[0])
    pairs = [(2008, 3, 4), (2004, 5, 6), (2000, 7, 8)]
    for cycle, di, ri in pairs:
        try:
            d = parse_pct(row[di])
            r = parse_pct(row[ri])
        except (ValueError, IndexError):
            continue
        if d is None or r is None:
            continue
        pres_out.append([cycle, "2008", state, district, round(r - d, 2)])

# --- Daily Kos 2008/2012 in 2012-cycle districts — full 435-district
#     coverage of 2008 (better than the 2008/12/16/20 sheet we already
#     parse above, which is missing ~109 districts for 2008).  When
#     both sheets have an entry for the same (year, district, cycle),
#     the entry that lands LATER in pres_out wins because we use a
#     dict-based index downstream.
with open("dailykos-2008-2012-pres-by-cd-2020-cycle.csv", newline="") as f:
    rdr = list(csv.reader(f))
for row in rdr[2:]:
    if not row or not row[0] or "-" not in row[0]:
        continue
    state, district = split_cd(row[0])
    pairs = [(2012, 3, 4), (2008, 5, 6)]
    for cycle, di, ri in pairs:
        try:
            d = parse_pct(row[di])
            r = parse_pct(row[ri])
        except (ValueError, IndexError):
            continue
        if d is None or r is None:
            continue
        pres_out.append([cycle, "2020", state, district, round(r - d, 2)])

# --- Atlas of U.S. Presidential Election Results by Congressional District
#     (Kiernan Park-Egan / WWU, 2022) — pres results for 1988, 1992, 1996,
#     and 2000 in the contemporary district lines for each year.  We only
#     emit the 1992-cycle (1992-2000 lines, used for the 1992-2000 elections)
#     rows: 1992, 1996, and 2000 each in 1992-cycle lines.  The 1988 sheet
#     is in 1980s-cycle lines, which don't map cleanly to the 1992-cycle
#     boundaries, so we exclude it (1994's PVI falls back to single-cycle
#     using only 1992).  district_cycle is labelled "2000" — the last
#     presidential election held in these lines — matching the existing
#     "<last pres year>" convention ("2008" = 2002-cycle, "2020" = 2012-cycle).
with open("atlas-1988-2000-pres-by-cd.csv", newline="") as f:
    rdr = csv.DictReader(f)
    for row in rdr:
        try:
            cycle = int(row["cycle"])
        except ValueError:
            continue
        if cycle not in (1992, 1996, 2000):
            continue
        state    = row["state"]
        district = _norm_district(row["district"])
        try:
            margin = round(float(row["margin"]), 2)
        except ValueError:
            continue
        pres_out.append([cycle, "2000", state, district, margin])

# --- Daily Kos 2020 in 2022-cycle (post-2020 redistricting, as used in
#     2022 elections) districts.  Schema: District, Incumbent, Party,
#     Biden, Trump, Margin.  Margin is precomputed but we re-derive
#     from D% / R% to match our R−D convention.
with open("dailykos-2020-pres-by-cd-2022-cycle.csv", newline="") as f:
    rdr = list(csv.reader(f))
for row in rdr[1:]:  # only one header row in this sheet
    if not row or not row[0] or "-" not in row[0]:
        continue
    state, district = split_cd(row[0])
    try:
        d = parse_pct(row[3])
        r = parse_pct(row[4])
    except (ValueError, IndexError):
        continue
    if d is None or r is None:
        continue
    pres_out.append([2020, "2022", state, district, round(r - d, 2)])

# Deduplicate by (cycle, district_cycle, state, district) — the new
# 2008-in-2020-cycle sheet has full 435-district coverage and should
# win over the older sheet's partial 2008 entries.  Last write wins.
pres_dedup = {}
for row in pres_out:
    key = (row[0], row[1], row[2], row[3])
    pres_dedup[key] = row

with open("pres-by-cd.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "district_cycle", "state", "district", "margin"])
    for r in sorted(pres_dedup.values()):
        w.writerow(r)
print(f"pres-by-cd.csv written ({len(pres_dedup)} rows)")

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
    # Districts present in ANY backing pres cycle for this district_cycle.
    # For each one, take the weighted average over whichever pres years
    # actually have data — falling back to single-cycle if a district
    # only has data in one of the cycles (e.g. 2008 is missing from many
    # post-2010-redistricted lines in the Daily Kos sheet).  Recompute
    # the matching national-avg using the SAME subset of cycles so the
    # district-vs-country comparison stays valid.
    all_districts = set()
    for (py, _) in weighted_years:
        all_districts |= set(pres_by_cycle[(py, district_cycle)].keys())
    for (state, district) in sorted(all_districts):
        present = [
            (py, w) for (py, w) in weighted_years
            if (state, district) in pres_by_cycle[(py, district_cycle)]
        ]
        if not present:
            continue
        total_w = sum(w for (_, w) in present)
        district_weighted = sum(
            pres_by_cycle[(py, district_cycle)][(state, district)] * w
            for (py, w) in present
        )
        nat_weighted = sum(NATIONAL_PRES_MARGIN[py] * w for (py, w) in present)
        pvi = round(district_weighted / total_w - nat_weighted / total_w, 2)
        pvi_out.append([midterm, district_cycle, state, district, pvi])

with open("pvi-by-cd.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cycle", "district_cycle", "state", "district", "pvi"])
    for r in pvi_out:
        w.writerow(r)
print(f"pvi-by-cd.csv written ({len(pvi_out)} rows)")
