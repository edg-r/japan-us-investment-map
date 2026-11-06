# Japanese investment, by state

Live site: https://edg-r.github.io/japan-us-investment-map/

A static map of documented investment commitments and transactions involving Japanese firms, from 2014 through 29 October 2026.

The **heat map is the main view**. Each state’s color is its documented subtotal: the sum of sourced, state-specific amounts in the ledger, on a log scale where larger amounts are darker green in the light theme and brighter green in the dark theme. A blank total is hatched, not drawn as zero. It is not foreign-direct-investment stock. The headline figure, **$41.04 billion**, is that sum across 41 states, rounded for display. Ten states have a record and no state total.

Click a state for the companies there. Click a company name to frame Japan and the Pacific and light that company’s other U.S. states.

Flows are corporate links from a Japanese parent office to a U.S. project, headquarters, or state reference. Nearby Japanese origins are merged into five regional ports at representative city locations on the Japan outline; record details retain the original office location. Alaska and Hawaii use separate insets beside the western states, above the desktop legend. **Arc width follows the record’s documented amount** on a square-root scale. Arcs stay faint until hovered or selected. Dashed arcs have no state-allocated amount. They are not traced bank transfers.

## Open locally

From this directory:

```bash
python3 -m http.server 8731
```

Then open [http://127.0.0.1:8731](http://127.0.0.1:8731).

`index.html` also opens directly in a browser. Scripts are plain files, not modules, so a server is optional.

## GitHub Pages

The site is a static root: `index.html`, `css/`, `js/`, `vendor/`, and `fonts/`. Publish the branch with Pages set to the root. No build step is required to view it.

To regenerate `js/data.js` and `js/atlas.js` after editing the files in `source/`:

```bash
node scripts/build.mjs
```

## Map controls

- **States** opens the state ranking. **Companies** opens a searchable, sortable company list; select a company for its total, state records and Pacific links. Clear the “Showing” chip or press Escape to return to all companies. Company selections can be shared with `#company=toyota`.

- **Both** is the default. **Heat map** and **Flows** turn one layer off.
- Click or focus a state for its total and records. Click a flow for that record.
- Arrow keys move between states. Enter opens the record list. Escape closes it.
- The dollar figure in the header opens **About these figures**. The footer’s **Download data** link opens the download tab with format descriptions and a citation. The dialog has a sticky close button, closes with Escape or a backdrop click, and restores focus to its opener.

## Data

[Download all formats](data/japan_us_investment_data.zip), or use the site's **Download data** entry point for CSV, Excel, Stata 118 (Stata 14+), and a GeoPackage for QGIS. The release contains **67 records and 51 states including DC**, as of **2026-10-29**. Both tables sum to **41,036 USD millions**. Ten state totals remain blank. See [CODEBOOK.md](data/CODEBOOK.md) for all variables, units, category values, sources, limitations and the geometry repair log. The GeoPackage retains all 67 project rows: 63 points and four null geometries where the ledger has no coordinates.

The data compilation is licensed **CC BY 4.0**; source materials and trademarks retain their rights. Suggested citation: Agunias, E. (2026). *Japanese investment in U.S. states, 2014 to October 2026* [Data set]. https://edg-r.github.io/japan-us-investment-map/

To reproduce the exports, create a Python 3 virtual environment, install `pandas openpyxl geopandas`, and run:

```bash
python3 -I scripts/export_dataset.py --ledger /path/to/investment-ledger.csv
```

The script uses `js/data.js` as the numerical source of truth, checks exact IDs and ledger amounts, and fails on a mismatch. It derives state polygons from bundled `js/atlas.js`; no geography download is needed. It applies a conservative missing-space cleanup to exported free-text fields only. The source ledger, IDs, URLs, codes, units and all numbers remain unchanged. Every changed string is logged with its record ID, field, original text and revised text in `data/validation_report.json`. It reads back all saved formats and checks their counts and totals. If pandas is unavailable, CSVs and `import_stata.do` provide the Stata import path. If geopandas is unavailable, GeoJSON replaces the GeoPackage. Excel requires openpyxl. The ZIP also includes the script and input files; after extracting, reproduce with `python3 -I scripts/export_dataset.py --ledger reproduction/investment-ledger.csv`.

## Credits

State shapes are the U.S. Census / Natural Earth composite from [us-atlas](https://github.com/topojson/us-atlas) (`states-10m`). The Japan outline is a simplified extract of Natural Earth via [world-atlas](https://github.com/topojson/world-atlas). The map is drawn with [D3](https://d3js.org/). Type is [Inter](https://rsms.me/inter/) and [Newsreader](https://github.com/productiontype/Newsreader), both under the SIL Open Font License.

## Deploying changes

GitHub Pages lets browsers cache CSS and JavaScript for 10 minutes. After editing `css/` or `js/`, bump the `?v=` value on those links in `index.html` so visitors never get new HTML with old styles.
