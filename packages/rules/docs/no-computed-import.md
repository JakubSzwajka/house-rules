# no-computed-import

Production package and app source imports by string literal only. Dependency Cruiser records a static import edge, but not import(at). A computed specifier can hide a facade, handler or SQL dependency from the browser proof.

Enable configs.features or featuresConfig({appsDir,packagesDir}). Both roots use layout()'s exact path/list parsing. Tests are exempt. Coverage includes package contracts, read models, app feature indexes and registry and client endpoints.ts, including every production file those roots could reach.

```js
import { featuresConfig } from "@house-rules/rules";
export default [...featuresConfig({ appsDir: "services", packagesDir: "libs" })];
```

Literal import(), require() and a template without interpolation remain visible and allowed. Computed identifiers, interpolated templates and concatenated specifiers fail. The rule complements browser-safe reachability; it does not replace it.
