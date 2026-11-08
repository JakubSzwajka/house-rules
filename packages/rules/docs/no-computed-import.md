# no-computed-import

Production package and app source imports by string literal only. Dependency Cruiser records a static import edge, but not import(at). A computed specifier can hide an adapter, SQL or test dependency from the layout rules and the cycle checks.

Enable configs.workspace or workspaceConfig({appsDir,packagesDir}). Both roots use layout()'s exact path/list parsing. Tests are exempt. Coverage is every production file under `<root>/*/src`.

```js
import { workspaceConfig } from "@house-rules/rules";
export default [...workspaceConfig({ appsDir: "services", packagesDir: "libs" })];
```

Literal import(), require() and a template without interpolation stay visible and allowed. Computed identifiers, interpolated templates and concatenated specifiers fail.
