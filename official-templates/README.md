# Official DOM template package

This directory is a frozen, self-contained package extracted from saved official ChatGPT pages. The original browser captures are provenance material, not build inputs.

- `shell.html` is the reusable page shell with an empty conversation message list.
- `templates.json` contains reusable visual DOM fragments only.
- `assets/` contains the official stylesheets and favicon used by those fragments.
- Six `preview:*` templates preserve the official file and pasted-text viewer DOM.
- Captured sample conversation sections belong to the acceptance fixture, not this package.

The JSON-to-HTML renderer reads only this package. `npm run extract:templates` now validates and normalizes the frozen package itself, so rebuilding and testing no longer require the original saved pages. Updating the package for a future ChatGPT UI revision is a separate, explicit migration task.
