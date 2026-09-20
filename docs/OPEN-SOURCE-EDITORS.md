# Open-source visual editors

Studio includes two local editor packages behind the **Advanced canvas** button:

- [GrapesJS 0.23.6](https://github.com/GrapesJS/grapesjs), BSD 3-Clause — the visual editing surface.
- [VvvebJs 2.0.9](https://github.com/givanz/VvvebJs), Apache 2.0 — the component vocabulary and block patterns.

Their versions are pinned in `package.json` and both are loaded from `node_modules`, never from a CDN. The local `data/editor-bridge.js` is the boundary between those runtimes and Studio.

## Deliberate boundary

The existing AI generator, project JSON model, export Builder, Concierge, schedules, legal pages and quality checks remain authoritative. The canvas stores an explicitly saved, size-limited `project.editorCanvas` snapshot; opening or editing the canvas does not silently rewrite the exported site. This keeps the integration reversible while the HTML-to-section mapping is expanded in a later pass.

GrapesJS telemetry is disabled and its storage manager is disabled. VvvebJS is namespaced separately as `Vvveb`; the bridge never aliases it over `grapesjs` or lets either runtime select an external storage endpoint.

When updating either package, review the upstream licence and changelog, update the pinned version, run `npm install`, then run `npm run release:check`. Do not replace the pins with a floating CDN URL.
