# Japanese investment, by state

Live site: https://edg-r.github.io/japan-us-investment-map/

A static map of documented investment commitments and transactions involving Japanese firms, from 2014 through 29 October 2026.

The **heat map is the main view**. Each state’s color is its documented subtotal: the sum of sourced, state-specific amounts in the ledger, on a log scale where deeper green is more funding. A blank total is hatched, not drawn as zero. It is not foreign-direct-investment stock. The headline figure, **$41.036 billion**, is that sum across 41 states. Ten states have a record and no state total.

Click a state for the companies there. Click a company name to frame Japan and the Pacific and light that company’s other U.S. states.

Flows are corporate links from a Japanese parent office to a U.S. project, headquarters, or state reference. **Arc width follows the record’s documented amount** on a square-root scale. Dashed arcs have no state-allocated amount. They are not traced bank transfers.

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

- **Both** is the default. **Heat map** and **Flows** turn one layer off.
- Click or focus a state for its total and records. Click a flow for that record.
- Arrow keys move between states. Enter opens the record list. Escape closes it.
- The dollar figure in the header opens a short note on what the total is and is not.

## Credits

State shapes are the U.S. Census / Natural Earth composite from [us-atlas](https://github.com/topojson/us-atlas) (`states-10m`). The Japan outline is a simplified extract of Natural Earth via [world-atlas](https://github.com/topojson/world-atlas). The map is drawn with [D3](https://d3js.org/). Type is [Inter](https://rsms.me/inter/) and [Newsreader](https://github.com/productiontype/Newsreader), both under the SIL Open Font License.
