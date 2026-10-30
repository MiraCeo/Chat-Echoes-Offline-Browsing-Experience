# Vendored Turbo

`turbo.es2017-umd.js` is the UMD build of Hotwired Turbo 8.0.23.

Source package: https://www.npmjs.com/package/@hotwired/turbo
License: MIT (see the license header in the bundled file).

Vendored so isolated fixture builds do not need `node_modules/@hotwired/turbo`.
`scripts/build-sidebar-controls.mjs` reads this file, hashes it into
`replay/public/turbo.<hash>.js`, and injects it only into generated replay pages.
