# Codebook

## Title

Japanese investment in U.S. states, 2014 to October 2026

## Coverage

67 records; 51 states including District of Columbia; 41 quantified states; 10 without a state total. Research cutoff: 2026-10-29.

## Documented subtotal

41,036 USD millions ($41.036 billion), nominal dollars. Sourced state-specific announced commitments, completed project totals and acquisition/equity prices, counted once. Sum amount_usd_million, not whole transaction values.

## Interpretation

Not foreign direct investment (FDI) stock, annual flows, cumulative Japanese spending, or verified transfers from Japan. Commitments can span years; completed facilities can retain announced program amounts. Null is not zero.

## Method

Exact map IDs and amounts reconciled against the fuller research ledger; state totals, basis components and counts recomputed independently. Primary company releases/reports, regulatory filings, and state/local announcements supply record-level URLs and evidence.

## Text cleanup

Exported free-text fields insert missing spaces after a conservative list of natural-language words before numbers. IDs, codes, units, dates and URLs are unchanged. Source ledger and map inputs are unchanged. Every changed string appears with its record ID, field, original and exported text in validation_report.json.

## Limitations

Selected documented records, not a census. Amounts use different monetary concepts, announcement dates and valuation scopes. No inflation or currency-year adjustment. Global and multistate deals without state allocations and presence-only records stay unpriced. Related Japanese-party ownership transfers can be included without net new investment. Read allocation_note before aggregation.

## Dates

Coverage describes selected projects from 2014 through 2026-10-29. Earlier source/event dates can occur for an included project. Date fields retain exact known ledger dates; no missing date is inferred from a year.

## Geography

EPSG:4326 longitude/latitude; states from bundled us-atlas states-10m (U.S. Census/Natural Earth composite), unprojected from TopoJSON. Points use ledger coordinates, commonly approximate city/headquarters references. Records with no coordinates retain null geometry; no centroid is invented. Not for cadastral or facility precision.

## Formats

UTF-8 CSV, Stata release 118 (Stata 14+), Excel, and GeoPackage for QGIS. In Stata categorical strings are alphabetically encoded with value labels; date variables are daily Stata dates. CSV and Excel retain category strings. FIPS codes are strings with leading zeros.

## License

Data compilation: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/. Attribute Edgar Agunias and link the dataset. Underlying source material and company trademarks retain their rights. Geometry provenance: https://github.com/topojson/us-atlas (ISC) and Census/Natural Earth public-domain source data.

## Citation

Agunias, E. (2026). Japanese investment in U.S. states, 2014 to October 2026 [Data set]. https://edg-r.github.io/japan-us-investment-map/

## Reproduce

Run python3 -I scripts/export_dataset.py --ledger /path/to/investment-ledger.csv from the repository. Requires Python 3 and openpyxl; pandas enables .dta; geopandas enables .gpkg, otherwise GeoJSON is written. Install in an isolated virtual environment. Map files supply all published numbers; mismatch aborts export.

## Geometry repair log

The quantized bundled topology contains a collapsed Delaware island and a self-touching Oregon ring. The GeoPackage uses Shapely make_valid and retains polygon components only. The original map topology and all attributes remain unchanged. Repairs: [{"state_code": "DE", "reason": "Too few points in geometry component[-75.5603153637536 39.630063805328]", "method": "Shapely make_valid; retain polygon components only", "area_change_square_degrees": -1.1102230246251565e-16}, {"state_code": "OR", "reason": "Ring Self-intersection[-119.999364290343 41.9950551335413]", "method": "Shapely make_valid; retain polygon components only", "area_change_square_degrees": -1.4210854715202004e-14}]

## Variables

Blank CSV fields and null spatial attributes represent missing values. Component amounts remain blank when absent. Allowed categories below enumerate the release values. Stata uses labeled numeric categories in alphabetical order starting at 0; import_stata.do uses Stata encode (starting at 1), so use value labels rather than numeric codes across imports.

### Records

| Variable | Type | Units | Allowed values | Definition |
|---|---|---|---|---|
| id | string | none | free text; blank = missing | Stable source-ledger record identifier; unique within Records. |
| firm_group | string | none | Ajinomoto; Astellas; Astemo; Daikin; Denso; Etria; Fujifilm; Fujitsu; Hisamitsu; Hitachi; Honda; Kawasaki; Kikkoman; Kubota; Mazda & Toyota; Mitsubishi Corporation; Mitsubishi Electric; Mitsubishi Heavy Industries; Mitsui / JERA; Mitsui Fudosan; Mori Trust; NIPPN; NTT; Nippon Steel; Nissui Corporation; Olympus; Omron; Otsuka; Panasonic; Recruit; Resorttrust; Sakae Casting; Sekisui Chemical; Sekisui House REIT; Shimadzu; SoftBank; Spiber; Sumitomo Rubber; Terumo; Tokyo Century; Tokyo Ohka / Hamamatsu; Toray; Toyota; Yamabiko Corporation; Yamato Kogyo; Yokohama Rubber | Company grouping used by the map for linked company views. |
| firm | string | none | free text; blank = missing | Named U.S. business, target, joint venture or investing firm. |
| japanese_parent | string | none | free text; blank = missing | Japanese parent or investors identified in the source. |
| origin_city_japan | string | none | free text; blank = missing | Ledger corporate-origin city in Japan; not the financing source. |
| origin_prefecture_japan | string | none | free text; blank = missing | Prefecture containing the ledger corporate-origin city. |
| state_code | string | none | AK; AL; AR; AZ; CA; CO; CT; DC; DE; FL; GA; HI; IA; ID; IL; IN; KS; KY; LA; MA; MD; ME; MI; MN; MO; MS; MT; NC; ND; NE; NH; NJ; NM; NV; NY; OH; OK; OR; PA; RI; SC; SD; TN; TX; UT; VA; VT; WA; WI; WV; WY | Two-letter U.S. postal code, including DC; join key to States. |
| state_name | string | none | free text; blank = missing | Full state or District of Columbia name. |
| city | string | none | free text; blank = missing | U.S. destination locality, if established; blank when state-only. |
| latitude | numeric | degrees (EPSG:4326) | -90 to 90 or blank | Ledger U.S. destination latitude; approximate city or reference location, not necessarily a facility. |
| longitude | numeric | degrees (EPSG:4326) | -180 to 180 or blank | Ledger U.S. destination longitude; paired with latitude; not an invented state centroid. |
| project_name | string | none | free text; blank = missing | Project, transaction, presence or cooperation record title. |
| sector | string | none | free text; blank = missing | Descriptive activity or industry; not a standardized industry classification. |
| amount_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | Exactly the map's state-allocated documented amount; sum this column for the national subtotal. Blank amounts are excluded, not zero. |
| amount_qualifier | string | none | about; at least; reported | Reported, approximate (about), or lower-bound (at least) qualifier; separate from the numeric amount. |
| amount_basis | string | none | acquisition_price; announced_project_total; completed_project_total; undisclosed | Monetary concept: announced project commitment, completed project total, acquisition price, or undisclosed. Project completion status does not change this basis. |
| transaction_value_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | Whole-transaction value where reported; may be multistate or global and must not be added to the mapped amount. |
| announcement_date | ISO date | none | YYYY-MM-DD or blank | Ledger announcement/event date in ISO format; may differ from the current source date or the map's display year. |
| status | string | none | announced; closed subsequently; completed; operating; status uncertain; models canceled; under_construction; unknown | Recorded project or transaction status as of research cutoff; not independently refreshed after that date. |
| record_kind | string | none | acquisition / equity; cooperation agreement; documented project; existing presence; ownership transfer between Japanese-affiliated parties | Nature of the documented record; presence and cooperation records do not imply a priced investment. |
| route_kind | string | none | company reference; spending not state-allocated; cooperation agreement; no investment amount established; existing presence; no investment amount established; project location; target headquarters; deal not state-allocated | Meaning of the map destination; headquarters and company-reference markers do not establish state spending. |
| ownership_scope | string | none | free text; blank = missing | Ownership, joint-venture or transaction scope needed to interpret the amount. |
| allocation_note | string | none | free text; blank = missing | Substantive research caveats about geographic allocation, overlap, valuation, ownership and financing. Retained from the research ledger. |
| investor_commitment_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | Separately disclosed Japanese investor commitment, when available; not an additional amount to add to the subtotal. |
| investor_commitment_note | string | none | free text; blank = missing | Scope and limitations of the separately reported investor commitment. |
| financing_origin_verified | integer | none | 0 = no; 1 = yes; blank = missing | Whether geographic origin of financing was verified; a Japanese parent alone does not establish a transfer from Japan. |
| source_url | string | none | free text; blank = missing | Primary supporting source link used by the map. |
| source_title | string | none | free text; blank = missing | Title of the primary supporting source. |
| source_publisher | string | none | free text; blank = missing | Publisher or issuing organization of the source. |
| source_date | ISO date | none | YYYY-MM-DD or blank | Ledger publication date of the linked source, when established. |
| origin_source_url | string | none | free text; blank = missing | Supporting source for the Japanese corporate origin. |
| evidence_summary | string | none | free text; blank = missing | Source-specific evidence supporting the record, including scope limitations. |
| state_fips | string | none | 01; 02; 04; 05; 06; 08; 09; 10; 11; 12; 13; 15; 16; 17; 18; 19; 20; 21; 22; 23; 24; 25; 26; 27; 28; 29; 30; 31; 32; 33; 34; 35; 36; 37; 38; 39; 40; 41; 42; 44; 45; 46; 47; 48; 49; 50; 51; 53; 54; 55; 56 | Two-character Federal Information Processing Standards state identifier, with leading zero; derived from bundled us-atlas feature ID. |
| state_allocated | integer | none | 0 = no; 1 = yes; blank = missing | Map flag identifying a record with a state-allocated amount. |
| dest_kind | string | none | city; state | Map destination precision: city or state. City points can be approximate corporate-reference locations. |
| origin_longitude | numeric | degrees (EPSG:4326) | -180 to 180 or blank | Corporate-origin longitude used by the map, before inset port aggregation. |
| origin_latitude | numeric | degrees (EPSG:4326) | -90 to 90 or blank | Corporate-origin latitude used by the map, before inset port aggregation. |
| as_of | ISO date | none | 2026-10-29 | Research cutoff for this release; not the download or export date. |

### States

| Variable | Type | Units | Allowed values | Definition |
|---|---|---|---|---|
| state_fips | string | none | 01; 02; 04; 05; 06; 08; 09; 10; 11; 12; 13; 15; 16; 17; 18; 19; 20; 21; 22; 23; 24; 25; 26; 27; 28; 29; 30; 31; 32; 33; 34; 35; 36; 37; 38; 39; 40; 41; 42; 44; 45; 46; 47; 48; 49; 50; 51; 53; 54; 55; 56 | Two-character Federal Information Processing Standards state identifier, with leading zero; derived from bundled us-atlas feature ID. |
| state_code | string | none | AK; AL; AR; AZ; CA; CO; CT; DC; DE; FL; GA; HI; IA; ID; IL; IN; KS; KY; LA; MA; MD; ME; MI; MN; MO; MS; MT; NC; ND; NE; NH; NJ; NM; NV; NY; OH; OK; OR; PA; RI; SC; SD; TN; TX; UT; VA; VT; WA; WI; WV; WY | Two-letter U.S. postal code, including DC; join key to States. |
| state_name | string | none | free text; blank = missing | Full state or District of Columbia name. |
| documented_total_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | Exactly the state's map subtotal across nonmissing mapped amounts; blank means no state total. |
| announced_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | State sum with announced_project_total basis; blank when that component is absent. |
| completed_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | State sum with completed_project_total basis; blank when that component is absent. |
| acquisition_usd_million | numeric | USD millions (nominal) | nonnegative number or blank | State sum with acquisition_price basis; blank when that component is absent. |
| record_count | integer | records | nonnegative number or blank | Count of all records assigned to the state, including unpriced records. |
| priced_record_count | integer | records | nonnegative number or blank | Count of records with a nonmissing mapped amount. |
| unpriced_record_count | integer | records | nonnegative number or blank | Count of records excluded from the subtotal because mapped amount is missing. |
| no_state_total | integer | none | 0 = no; 1 = yes; blank = missing | 1 if documented state subtotal is missing; 0 if a documented subtotal exists. Missing does not mean zero investment. |
| as_of | ISO date | none | 2026-10-29 | Research cutoff for this release; not the download or export date. |

### Spatial geometry

`states.geometry`: Polygon or MultiPolygon from bundled us-atlas, in EPSG:4326. `projects.geometry`: Point from longitude/latitude, or null if unavailable. All 67 records are retained in the projects layer, including null geometries. GeoPackage may add an internal feature identifier; `id` and `state_fips` are the analytical join keys. Geometry is never shifted into display insets.
