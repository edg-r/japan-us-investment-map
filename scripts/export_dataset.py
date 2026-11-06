#!/usr/bin/env python3
"""Export the published map and reconcile its fuller research ledger.

Run with python3 -I scripts/export_dataset.py --ledger /path/investment-ledger.csv
Optional packages: pandas (Stata), openpyxl (Excel), geopandas (GeoPackage).
No network access is used. Any record, amount or state-total mismatch is fatal.
"""
import argparse
import csv
import hashlib
import importlib.util
import json
import math
import re
import sys
import zipfile
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data"
PREFIX = "japan_us_investment"
CITATION = ("Agunias, E. (2026). Japanese investment in U.S. states, 2014 to October "
            "2026 [Data set]. https://edg-r.github.io/japan-us-investment-map/")
DEFAULT_LEDGER = Path("/Users/edgarmacmini/Claudia/_claudia/outputs/"
                      "japan-us-investment-tracing/investment-ledger.csv")
RENAME = {
    "japanese_investor_commitment_usd_million": "investor_commitment_usd_million",
    "japanese_investor_commitment_note": "investor_commitment_note",
}
CATEGORICAL = {"firm_group", "amount_basis", "amount_qualifier", "status",
               "record_kind", "route_kind", "dest_kind"}
FLAGS = {"no_state_total", "state_allocated", "financing_origin_verified"}
NUMERIC = {"latitude", "longitude", "origin_latitude", "origin_longitude",
           "amount_usd_million", "transaction_value_usd_million",
           "investor_commitment_usd_million", "documented_total_usd_million",
           "announced_usd_million", "completed_usd_million", "acquisition_usd_million",
           "record_count", "priced_record_count", "unpriced_record_count"} | FLAGS
DATES = {"announcement_date", "source_date", "as_of"}
# Only prose fields are eligible. Identifiers, categories, dates, company names,
# URLs, geographic codes and all numeric fields retain their source values.
FREE_TEXT = {"project_name", "sector", "ownership_scope", "allocation_note",
             "investor_commitment_note", "source_title", "evidence_summary"}
# Reviewed natural-language words, not a blanket letter/digit substitution.
# This intentionally leaves unfamiliar tokens for human review (e.g. p28, VA3,
# FY2024, CO2, H2, USD25m), as well as units and ordinals such as 10m and 3rd.
PROSE_WORDS = ("in", "to", "of", "with", "for", "adding", "create", "floors",
               "underground", "page", "half", "late", "summer", "Numeric", "onAugust",
               "January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December")
MISSING_SPACE = re.compile(
    r"https?://\S+|www\.\S+|(?<![\w/.-])(?P<word>" +
    "|".join(PROSE_WORDS) + r")(?=\d)")


def clean_free_text(value):
    """Insert only reviewed word/number spaces, preserving embedded URLs."""
    if not isinstance(value, str):
        return value
    return MISSING_SPACE.sub(
        lambda m: ("on August" if m.group("word") == "onAugust" else m.group(0)) + " "
        if m.group("word") else m.group(0), value)


DEFINITIONS = {
    "id": "Stable source-ledger record identifier; unique within Records.",
    "firm_group": "Company grouping used by the map for linked company views.",
    "firm": "Named U.S. business, target, joint venture or investing firm.",
    "japanese_parent": "Japanese parent or investors identified in the source.",
    "origin_city_japan": "Ledger corporate-origin city in Japan; not the financing source.",
    "origin_prefecture_japan": "Prefecture containing the ledger corporate-origin city.",
    "state_code": "Two-letter U.S. postal code, including DC; join key to States.",
    "state_fips": "Two-character Federal Information Processing Standards state identifier, with leading zero; derived from bundled us-atlas feature ID.",
    "state_name": "Full state or District of Columbia name.",
    "city": "U.S. destination locality, if established; blank when state-only.",
    "latitude": "Ledger U.S. destination latitude; approximate city or reference location, not necessarily a facility.",
    "longitude": "Ledger U.S. destination longitude; paired with latitude; not an invented state centroid.",
    "origin_latitude": "Corporate-origin latitude used by the map, before inset port aggregation.",
    "origin_longitude": "Corporate-origin longitude used by the map, before inset port aggregation.",
    "project_name": "Project, transaction, presence or cooperation record title.",
    "sector": "Descriptive activity or industry; not a standardized industry classification.",
    "amount_usd_million": "Exactly the map's state-allocated documented amount; sum this column for the national subtotal. Blank amounts are excluded, not zero.",
    "amount_qualifier": "Reported, approximate (about), or lower-bound (at least) qualifier; separate from the numeric amount.",
    "amount_basis": "Monetary concept: announced project commitment, completed project total, acquisition price, or undisclosed. Project completion status does not change this basis.",
    "transaction_value_usd_million": "Whole-transaction value where reported; may be multistate or global and must not be added to the mapped amount.",
    "announcement_date": "Ledger announcement/event date in ISO format; may differ from the current source date or the map's display year.",
    "status": "Recorded project or transaction status as of research cutoff; not independently refreshed after that date.",
    "record_kind": "Nature of the documented record; presence and cooperation records do not imply a priced investment.",
    "route_kind": "Meaning of the map destination; headquarters and company-reference markers do not establish state spending.",
    "ownership_scope": "Ownership, joint-venture or transaction scope needed to interpret the amount.",
    "allocation_note": "Substantive research caveats about geographic allocation, overlap, valuation, ownership and financing. Retained from the research ledger.",
    "investor_commitment_usd_million": "Separately disclosed Japanese investor commitment, when available; not an additional amount to add to the subtotal.",
    "investor_commitment_note": "Scope and limitations of the separately reported investor commitment.",
    "financing_origin_verified": "Whether geographic origin of financing was verified; a Japanese parent alone does not establish a transfer from Japan.",
    "source_url": "Primary supporting source link used by the map.",
    "source_title": "Title of the primary supporting source.",
    "source_publisher": "Publisher or issuing organization of the source.",
    "source_date": "Ledger publication date of the linked source, when established.",
    "origin_source_url": "Supporting source for the Japanese corporate origin.",
    "evidence_summary": "Source-specific evidence supporting the record, including scope limitations.",
    "state_allocated": "Map flag identifying a record with a state-allocated amount.",
    "dest_kind": "Map destination precision: city or state. City points can be approximate corporate-reference locations.",
    "as_of": "Research cutoff for this release; not the download or export date.",
    "documented_total_usd_million": "Exactly the state's map subtotal across nonmissing mapped amounts; blank means no state total.",
    "announced_usd_million": "State sum with announced_project_total basis; blank when that component is absent.",
    "completed_usd_million": "State sum with completed_project_total basis; blank when that component is absent.",
    "acquisition_usd_million": "State sum with acquisition_price basis; blank when that component is absent.",
    "record_count": "Count of all records assigned to the state, including unpriced records.",
    "priced_record_count": "Count of records with a nonmissing mapped amount.",
    "unpriced_record_count": "Count of records excluded from the subtotal because mapped amount is missing.",
    "no_state_total": "1 if documented state subtotal is missing; 0 if a documented subtotal exists. Missing does not mean zero investment.",
}


def js_value(path, assignment):
    return json.JSONDecoder().raw_decode(path.read_text(encoding="utf-8").split(assignment, 1)[1].lstrip())[0]


def check(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    if value in (None, ""):
        return None
    result = float(value)
    check(math.isfinite(result), "Nonfinite numeric value")
    return int(result) if result.is_integer() else result


def close(a, b):
    return a is b if a is None or b is None else math.isclose(a, b, abs_tol=1e-7)


def polygons(topology):
    """Decode bundled TopoJSON delta arcs without a network geometry dependency."""
    scale, translate = topology["transform"]["scale"], topology["transform"]["translate"]
    decoded = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append([x * scale[0] + translate[0], y * scale[1] + translate[1]])
        decoded.append(points)

    def ring(indices):
        points = []
        for index in indices:
            arc = decoded[index] if index >= 0 else list(reversed(decoded[~index]))
            points.extend(arc if not points else arc[1:])
        while len(points) < 4:
            points.append(points[0])
        return points

    result = {}
    for geom in topology["objects"]["states"]["geometries"]:
        if geom["type"] == "Polygon":
            coordinates = [ring(r) for r in geom["arcs"]]
        elif geom["type"] == "MultiPolygon":
            coordinates = [[ring(r) for r in poly] for poly in geom["arcs"]]
        else:
            raise ValueError("Unsupported topology geometry: " + geom["type"])
        result[geom["properties"]["name"]] = (
            str(geom["id"]).zfill(2), {"type": geom["type"], "coordinates": coordinates})
    return result


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def codebook_rows(tables):
    rows = []
    for table, records in tables.items():
        for key in records[0]:
            check(re.fullmatch(r"[a-z][a-z0-9_]{0,31}", key), "Invalid variable name: " + key)
            check(key in DEFINITIONS, "Undocumented variable: " + key)
            values = sorted({str(r[key]) for r in records if r[key] is not None})
            kind = "integer" if key in FLAGS or key.endswith("_count") else "numeric" if key in NUMERIC else "ISO date" if key in DATES else "string"
            units = "USD millions (nominal)" if key.endswith("usd_million") else "degrees (EPSG:4326)" if key.endswith(("latitude", "longitude")) else "records" if key.endswith("_count") else "none"
            allowed = "0 = no; 1 = yes; blank = missing" if key in FLAGS else "; ".join(values) if key in CATEGORICAL or key in {"state_code", "state_fips", "as_of"} else "YYYY-MM-DD or blank" if key in DATES else "nonnegative number or blank" if key in NUMERIC and "itude" not in key else "-90 to 90 or blank" if key.endswith("latitude") else "-180 to 180 or blank" if key.endswith("longitude") else "free text; blank = missing"
            rows.append({"table": table, "variable": key, "type": kind, "units": units,
                         "allowed_values": allowed, "definition": DEFINITIONS[key]})
    return rows


def stata(tables, book):
    instructions = ["* Run from the extracted data folder. Requires Stata 14 or later.",
                    "version 14", "clear all", "set more off", ""]
    labels = {r["variable"]: r["definition"].split(";")[0][:80] for r in book}
    have_pandas = importlib.util.find_spec("pandas") is not None
    for name, rows in tables.items():
        stem = PREFIX + "_" + name
        instructions.extend([f'import delimited using "{stem}.csv", clear varnames(1) encoding("utf-8") stringcols(_all)',
                             "* Preserve state_fips as a two-character string, including leading zeros."])
        for key in rows[0]:
            if key in NUMERIC:
                instructions.append(f"destring {key}, replace")
            if key in DATES:
                instructions.extend([f'gen double date_tmp = daily({key}, "YMD")', f"drop {key}",
                                     f"rename date_tmp {key}", f"format {key} %tdCCYY-NN-DD"])
            instructions.append(f'label variable {key} "{labels[key]}"')
        for key in sorted(CATEGORICAL & rows[0].keys()):
            instructions.extend([f"encode {key}, gen(category_tmp)", f"drop {key}", f"rename category_tmp {key}",
                                 f'label variable {key} "{labels[key]}"'])
        instructions.append('label define yes_no 0 "No" 1 "Yes", replace')
        instructions.extend(f"label values {key} yes_no" for key in rows[0] if key in FLAGS)
        instructions.extend([f'assert _N == {len(rows)}', "preserve",
                             f'collapse (sum) {"amount_usd_million" if name == "records" else "documented_total_usd_million"}',
                             f'assert abs({"amount_usd_million" if name == "records" else "documented_total_usd_million"}[1] - 41036) < 0.000001',
                             "restore", f'save "{stem}.dta", replace', ""])
        if have_pandas:
            import pandas as pd
            frame = pd.DataFrame(rows)
            for key in frame:
                if key in NUMERIC:
                    frame[key] = pd.to_numeric(frame[key])
                elif key in DATES:
                    frame[key] = pd.to_datetime(frame[key])
                elif key in CATEGORICAL:
                    frame[key] = pd.Categorical(frame[key], categories=sorted(frame[key].dropna().unique()))
                else:
                    frame[key] = frame[key].fillna("")
            path = OUT / (stem + ".dta")
            frame.to_stata(path, version=118, write_index=False,
                           time_stamp=datetime(2026, 10, 29), data_label="Japanese investment; USD millions; 2026-10-29",
                           variable_labels={k: labels[k] for k in frame},
                           convert_dates={k: "td" for k in frame if k in DATES},
                           value_labels={k: {0: "No", 1: "Yes"} for k in frame if k in FLAGS})
            restored = pd.read_stata(path, convert_categoricals=False)
            amount = "amount_usd_million" if name == "records" else "documented_total_usd_million"
            check(len(restored) == len(rows) and close(restored[amount].sum(), 41036), "Stata readback failed")
            check(restored["state_fips"].str.len().eq(2).all(), "Stata FIPS width failed")
    (OUT / "import_stata.do").write_text("\n".join(instructions), encoding="utf-8")
    return have_pandas


def excel(tables, book, notes):
    if importlib.util.find_spec("openpyxl") is None:
        raise RuntimeError("Excel export requires openpyxl: python3 -I -m pip install openpyxl")
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    workbook = Workbook()
    workbook.remove(workbook.active)
    sheets = {"README": [{"topic": k, "description": v} for k, v in notes.items()],
              "Records": tables["records"], "States": tables["states"], "Codebook": book}
    for name, rows in sheets.items():
        sheet = workbook.create_sheet(name)
        keys = list(rows[0])
        sheet.append(keys)
        for row in rows:
            values = [date.fromisoformat(row[k]) if k in DATES and row[k] else row[k] for k in keys]
            sheet.append(values)
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        sheet.sheet_view.showGridLines = False
        for cell in sheet[1]:
            cell.fill = PatternFill("solid", fgColor="146C3A")
            cell.font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        sheet.row_dimensions[1].height = 38
        for col, key in enumerate(keys, 1):
            width = 18 if key in NUMERIC | DATES else 10 if key in {"state_code", "state_fips"} else 48 if key in {"description", "definition", "allocation_note", "evidence_summary", "source_url", "origin_source_url"} else 30
            sheet.column_dimensions[get_column_letter(col)].width = max(width, min(32, len(key) + 2))
            for cells in sheet.iter_rows(min_row=2, min_col=col, max_col=col):
                cell = cells[0]
                cell.font = Font(name="Calibri", size=11, color="183F29" if key in NUMERIC else "242824")
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                if key in DATES:
                    cell.number_format = "yyyy-mm-dd"
                elif key in NUMERIC:
                    cell.number_format = "#,##0.###" if key.endswith("usd_million") else "0.000000" if "itude" in key else "0"
                if cell.row % 2 == 0:
                    cell.fill = PatternFill("solid", fgColor="F2F7F3")
        for row in range(2, sheet.max_row + 1):
            sheet.row_dimensions[row].height = 96 if name in {"README", "Codebook"} else 78
    path = OUT / (PREFIX + ".xlsx")
    workbook.save(path)
    restored = load_workbook(path, data_only=True)
    for name, amount in [("Records", "amount_usd_million"), ("States", "documented_total_usd_million")]:
        rows = list(restored[name].values)
        check(len(rows) - 1 == len(tables[name.lower()]), "Excel row-count mismatch")
        index = rows[0].index(amount)
        check(close(sum(r[index] or 0 for r in rows[1:]), 41036), "Excel total mismatch")
        check(restored[name].freeze_panes == "A2" and restored[name].auto_filter.ref, "Excel controls missing")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    args = parser.parse_args()
    source = js_value(ROOT / "js/data.js", "window.MAP_DATA =")
    shape_by_name = polygons(js_value(ROOT / "js/atlas.js", "window.US_ATLAS ="))
    ledger = list(csv.DictReader(args.ledger.open(encoding="utf-8-sig", newline="")))
    check(len({r["id"] for r in ledger}) == len(ledger), "Duplicate ledger IDs")
    check(len({p["id"] for p in source["projects"]}) == len(source["projects"]), "Duplicate map IDs")
    by_id = {r["id"]: r for r in ledger}
    check(set(by_id) == {p["id"] for p in source["projects"]}, "Ledger/map ID mismatch")
    check(len(source["projects"]) == 67 and len(source["states"]) == 51, "Release record/state count changed")
    check(source["total"] == 41036 and source["asOf"] == "2026-10-29", "Release cutoff/total changed; review before exporting")
    states_by_code = {s["code"]: s for s in source["states"]}
    records = []
    text_cleanups = []
    mappings = {"state_code": "state", "firm": "firm", "firm_group": "firmGroup",
                "japanese_parent": "parent", "project_name": "project", "city": "city",
                "amount_basis": "basis", "amount_qualifier": "qualifier", "status": "status",
                "record_kind": "recordKind", "route_kind": "route", "source_url": "sourceUrl",
                "source_title": "sourceTitle", "source_publisher": "sourcePublisher", "evidence_summary": "evidence"}
    for project in source["projects"]:
        row = {RENAME.get(k, k): v or None for k, v in by_id[project["id"]].items()}
        check(close(number(row["amount_usd_million"]), project["amount"]), "Amount mismatch: " + project["id"])
        for ledger_key, map_key in mappings.items():
            check((row[ledger_key] or "") == (project.get(map_key) or ""), f"Field mismatch {project['id']}: {ledger_key}")
        check(row["state_name"] == states_by_code[project["state"]]["name"], "State-name mismatch")
        # Reconcile raw evidence first. Clean exported prose only, never inputs.
        for key in sorted(FREE_TEXT & row.keys()):
            original = row[key]
            cleaned = clean_free_text(original)
            if cleaned != original:
                text_cleanups.append({"id": row["id"], "field": key,
                                      "before": original, "after": cleaned})
                row[key] = cleaned
        for key in row:
            if key in NUMERIC - FLAGS:
                row[key] = number(row[key])
            elif key in FLAGS:
                row[key] = None if row[key] is None else int(str(row[key]).lower() == "true")
            elif key in DATES and row[key]:
                row[key] = date.fromisoformat(row[key]).isoformat()
        row["amount_usd_million"] = project["amount"]
        row.update(state_fips=shape_by_name[row["state_name"]][0],
                   state_allocated=int(project["allocated"]), dest_kind=project["destKind"],
                   origin_longitude=project["origin"][0], origin_latitude=project["origin"][1], as_of=source["asOf"])
        check((row["latitude"] is None) == (row["longitude"] is None), "Partial point coordinate")
        records.append(row)
    states = []
    for s in source["states"]:
        rows = [r for r in records if r["state_code"] == s["code"]]
        priced = [r["amount_usd_million"] for r in rows if r["amount_usd_million"] is not None]
        check(close(sum(priced) if priced else None, s["total"]), "State sum mismatch: " + s["code"])
        check(len(rows) == s["records"] and len(priced) == s["priced"] and len(rows)-len(priced) == s["unpriced"], "State count mismatch")
        for component, basis in [("announced", "announced_project_total"), ("completed", "completed_project_total"), ("acquisition", "acquisition_price")]:
            values = [r["amount_usd_million"] for r in rows if r["amount_basis"] == basis and r["amount_usd_million"] is not None]
            check(close(sum(values) if values else None, s[component]), "State component mismatch: " + s["code"])
        states.append(dict(state_fips=shape_by_name[s["name"]][0], state_code=s["code"], state_name=s["name"],
                           documented_total_usd_million=s["total"], announced_usd_million=s["announced"],
                           completed_usd_million=s["completed"], acquisition_usd_million=s["acquisition"],
                           record_count=s["records"], priced_record_count=s["priced"], unpriced_record_count=s["unpriced"],
                           no_state_total=int(s["total"] is None), as_of=source["asOf"]))
    for rows, column in [(records, "amount_usd_million"), (states, "documented_total_usd_million")]:
        check(close(sum(r[column] or 0 for r in rows), 41036), "National total mismatch")
    OUT.mkdir(exist_ok=True)
    tables = {"records": records, "states": states}
    book = codebook_rows(tables)
    notes = {
        "Title": "Japanese investment in U.S. states, 2014 to October 2026",
        "Coverage": "67 records; 51 states including District of Columbia; 41 quantified states; 10 without a state total. Research cutoff: 2026-10-29.",
        "Documented subtotal": "41,036 USD millions ($41.036 billion), nominal dollars. Sourced state-specific announced commitments, completed project totals and acquisition/equity prices, counted once. Sum amount_usd_million, not whole transaction values.",
        "Interpretation": "Not foreign direct investment (FDI) stock, annual flows, cumulative Japanese spending, or verified transfers from Japan. Commitments can span years; completed facilities can retain announced program amounts. Null is not zero.",
        "Method": "Exact map IDs and amounts reconciled against the fuller research ledger; state totals, basis components and counts recomputed independently. Primary company releases/reports, regulatory filings, and state/local announcements supply record-level URLs and evidence.",
        "Text cleanup": "Exported free-text fields insert missing spaces after a conservative list of natural-language words before numbers. IDs, codes, units, dates and URLs are unchanged. Source ledger and map inputs are unchanged. Every changed string appears with its record ID, field, original and exported text in validation_report.json.",
        "Limitations": "Selected documented records, not a census. Amounts use different monetary concepts, announcement dates and valuation scopes. No inflation or currency-year adjustment. Global and multistate deals without state allocations and presence-only records stay unpriced. Related Japanese-party ownership transfers can be included without net new investment. Read allocation_note before aggregation.",
        "Dates": "Coverage describes selected projects from 2014 through 2026-10-29. Earlier source/event dates can occur for an included project. Date fields retain exact known ledger dates; no missing date is inferred from a year.",
        "Geography": "EPSG:4326 longitude/latitude; states from bundled us-atlas states-10m (U.S. Census/Natural Earth composite), unprojected from TopoJSON. Points use ledger coordinates, commonly approximate city/headquarters references. Records with no coordinates retain null geometry; no centroid is invented. Not for cadastral or facility precision.",
        "Formats": "UTF-8 CSV, Stata release 118 (Stata 14+), Excel, and GeoPackage for QGIS. In Stata categorical strings are alphabetically encoded with value labels; date variables are daily Stata dates. CSV and Excel retain category strings. FIPS codes are strings with leading zeros.",
        "License": "Data compilation: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/. Attribute Edgar Agunias and link the dataset. Underlying source material and company trademarks retain their rights. Geometry provenance: https://github.com/topojson/us-atlas (ISC) and Census/Natural Earth public-domain source data.",
        "Citation": CITATION,
        "Reproduce": "Run python3 -I scripts/export_dataset.py --ledger /path/to/investment-ledger.csv from the repository. Requires Python 3 and openpyxl; pandas enables .dta; geopandas enables .gpkg, otherwise GeoJSON is written. Install in an isolated virtual environment. Map files supply all published numbers; mismatch aborts export.",
    }
    for name, rows in tables.items():
        write_csv(OUT / (PREFIX + "_" + name + ".csv"), rows)
    dta_available = stata(tables, book)
    features = {"states": [{"type": "Feature", "id": r["state_fips"], "properties": r,
                             "geometry": shape_by_name[r["state_name"]][1]} for r in states],
                "projects": [{"type": "Feature", "id": r["id"], "properties": r,
                              "geometry": {"type": "Point", "coordinates": [r["longitude"], r["latitude"]]} if r["latitude"] is not None else None} for r in records]}
    gpkg_available = importlib.util.find_spec("geopandas") is not None
    geometry_repairs = []
    if gpkg_available:
        import geopandas as gpd
        from shapely.geometry import shape
        from shapely import make_valid
        from shapely.ops import unary_union
        from shapely.validation import explain_validity
        path = OUT / (PREFIX + ".gpkg")
        if path.exists():
            path.unlink()
        for name, items in features.items():
            frame = gpd.GeoDataFrame([f["properties"] for f in items],
                                     geometry=[shape(f["geometry"]) if f["geometry"] else None for f in items], crs="EPSG:4326")
            # Quantized source topology contains a collapsed island (DE) and a
            # self-touching ring (OR). Repair only exported geometry, and log it.
            for index in frame.index[frame.geometry.notna() & ~frame.geometry.is_valid]:
                original = frame.at[index, "geometry"]
                fixed = make_valid(original)
                if fixed.geom_type == "GeometryCollection":
                    fixed = unary_union([g for g in fixed.geoms if g.geom_type in {"Polygon", "MultiPolygon"}])
                check(fixed.geom_type in {"Polygon", "MultiPolygon"}, "Repair lost polygon")
                geometry_repairs.append({"state_code": frame.at[index, "state_code"],
                                         "reason": explain_validity(original),
                                         "method": "Shapely make_valid; retain polygon components only",
                                         "area_change_square_degrees": fixed.area - original.area})
                frame.at[index, "geometry"] = fixed
            check(frame.geometry.dropna().is_valid.all(), "Invalid bundled geometry; review required")
            frame.to_file(path, layer=name, driver="GPKG", mode="w" if name == "states" else "a")
            restored = gpd.read_file(path, layer=name)
            amount = "documented_total_usd_million" if name == "states" else "amount_usd_million"
            check(len(restored) == len(items) and restored.crs.to_epsg() == 4326 and close(restored[amount].sum(), 41036), "GeoPackage readback mismatch")
            check(restored.geometry.isna().sum() == sum(f["geometry"] is None for f in items), "GeoPackage missing geometry mismatch")
    else:
        for name, items in features.items():
            (OUT / (name + ".geojson")).write_text(json.dumps({"type": "FeatureCollection", "features": items}, ensure_ascii=False), encoding="utf-8")
    sections = ["# Codebook\n"] + ["## " + k + "\n\n" + v + "\n" for k, v in notes.items()]
    if geometry_repairs:
        notes["Geometry repairs"] = "Delaware collapsed island and Oregon self-touching ring repaired with Shapely make_valid, retaining polygon components. Area changes are floating-point noise (below 1.5e-14 square degrees). Original bundled topology is unchanged. See validation_report.json for the complete repair log."
        sections.append("## Geometry repair log\n\nThe quantized bundled topology contains a collapsed Delaware island and a self-touching Oregon ring. The GeoPackage uses Shapely make_valid and retains polygon components only. The original map topology and all attributes remain unchanged. Repairs: " + json.dumps(geometry_repairs) + "\n")
    excel(tables, book, notes)
    sections.append("## Variables\n\nBlank CSV fields and null spatial attributes represent missing values. Component amounts remain blank when absent. Allowed categories below enumerate the release values. Stata uses labeled numeric categories in alphabetical order starting at 0; import_stata.do uses Stata encode (starting at 1), so use value labels rather than numeric codes across imports.\n")
    for table in tables:
        sections.append("### " + table.title() + "\n\n| Variable | Type | Units | Allowed values | Definition |\n|---|---|---|---|---|\n" + "\n".join("| " + " | ".join(str(r[k]).replace("|", " / ") for k in ["variable", "type", "units", "allowed_values", "definition"]) + " |" for r in book if r["table"] == table) + "\n")
    sections.append("### Spatial geometry\n\n`states.geometry`: Polygon or MultiPolygon from bundled us-atlas, in EPSG:4326. `projects.geometry`: Point from longitude/latitude, or null if unavailable. All 67 records are retained in the projects layer, including null geometries. GeoPackage may add an internal feature identifier; `id` and `state_fips` are the analytical join keys. Geometry is never shifted into display insets.\n")
    (OUT / "CODEBOOK.md").write_text("\n".join(sections), encoding="utf-8")
    (OUT / "LICENSE.md").write_text("# Data license\n\nCopyright 2026 Edgar Agunias. The research data compilation is licensed under Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/ . Attribute Edgar Agunias, link the dataset and license, and indicate changes. Source documents and company trademarks retain their own rights. Bundled us-atlas geometry is distributed under its ISC license; its Census/Natural Earth source data is public domain.\n\nSuggested citation: " + CITATION + "\n", encoding="utf-8")
    report = {"as_of": source["asOf"], "record_count": len(records), "state_count": len(states),
              "record_total_usd_million": sum(r["amount_usd_million"] or 0 for r in records),
              "state_total_usd_million": sum(r["documented_total_usd_million"] or 0 for r in states),
              "quantified_states": sum(not r["no_state_total"] for r in states),
              "unquantified_states": sum(r["no_state_total"] for r in states),
              "points_with_coordinates": sum(r["latitude"] is not None for r in records),
              "mismatches": [], "geometry_repairs": geometry_repairs,
              "text_cleanups": text_cleanups,
              "stata_118": dta_available, "geopackage": gpkg_available,
              "verified_readback": ["CSV", "Excel"] + (["Stata"] if dta_available else []) + (["GeoPackage states/projects EPSG:4326"] if gpkg_available else ["GeoJSON"]),
              "source_sha256": {"js/data.js": hashlib.sha256((ROOT / "js/data.js").read_bytes()).hexdigest(),
                                "investment-ledger.csv": hashlib.sha256(args.ledger.read_bytes()).hexdigest(),
                                "js/atlas.js": hashlib.sha256((ROOT / "js/atlas.js").read_bytes()).hexdigest()}}
    for name, expected in tables.items():
        readback = list(csv.DictReader((OUT / (PREFIX + "_" + name + ".csv")).open(encoding="utf-8")))
        amount = "amount_usd_million" if name == "records" else "documented_total_usd_million"
        check(len(readback) == len(expected) and close(sum(number(r[amount]) or 0 for r in readback), 41036), "CSV readback mismatch")
    (OUT / "validation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    files = [p for p in OUT.iterdir() if p.suffix in {".csv", ".dta", ".do", ".xlsx", ".gpkg", ".geojson", ".md"} or p.name == "validation_report.json"]
    with zipfile.ZipFile(OUT / (PREFIX + "_data.zip"), "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.write(path, path.name)
        archive.write(Path(__file__), "scripts/export_dataset.py")
        for path in [ROOT / "js/data.js", ROOT / "js/atlas.js"]:
            archive.write(path, "js/" + path.name)
        archive.write(args.ledger, "reproduction/investment-ledger.csv")
    manifest = {p.name: {"bytes": p.stat().st_size} for p in sorted(OUT.iterdir()) if p.name != "manifest.json" and p.is_file()}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        sys.exit("EXPORT FAILED: " + str(error))
