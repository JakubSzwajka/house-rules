# Design: no raw element rule

Rule ID: `house-rules/design-no-raw-element`

The rule runs on JSX and TSX. It reports an intrinsic element, such as `<button>`, when the app's component folder has a component for it. The `shadcn()` factory in `@house-rules/rules/shadcn` turns it on at `error`.

```tsx
<Button>Save</Button>                        // passes
<button type="submit">Save</button>          // reported when components/ui/button.tsx exists
<input type="hidden" name="id" value="7" />  // passes: a hidden input has no look
<table />                                    // passes when the folder has no table.tsx
<rows.Row />                                 // passes: not an intrinsic element
```

The message names the component and the file it lives in: `Use <Button> from src/components/ui/button.tsx instead of a raw <button>.`

A raw `<button>` next to a design-system `Button` drifts: it misses the focus ring, the sizes and the variants, and nothing warns you. An agent that writes one does not know the component exists. The message tells it.

## What the rule checks

It visits every JSX opening element whose name is a plain lower-case identifier. Member names such as `<table.FlexRender>`, namespaced names and components are never reported.

An element is reported when its entry in the element map names a component file and the component folder holds that file. "Has a component" comes from the folder, not from a fixed list: the rule globs the `components` folders and collects each file's name without its extension, so `button.tsx` gives `button` and `native-select.tsx` gives `native-select`. The message turns the file name into PascalCase, `NativeSelect`. An app that has no `table.tsx` gets no report for `<table>`.

The default map follows shadcn/ui's file names:

| Element | Component files, first match wins | Exempt |
| --- | --- | --- |
| `button` | `button` | |
| `input` | `input` | `type="hidden"` |
| `textarea` | `textarea` | |
| `select` | `native-select`, `select` | |
| `table` | `table` | |
| `dialog` | `dialog` | |

`<a>` is not in the map. The component that replaces it is a framework's link, such as Next.js's `Link`, and it does not live in the component folder. Add it yourself; see `elements` below.

The rule does nothing in a file that matches `components` or `allow`. The `shadcn()` component-folder block also turns it off.

## Options

```ts
type Entry =
  | false                                  // drop a default
  | string | string[]                      // component file names in the folder
  | {
      component: string | string[];        // component file names in the folder
      unless?: Record<string, string[]>;   // attribute values that exempt the element
    }
  | {
      use: string;                         // always report, and name this component
      from?: string;                       // shown in the message, such as "next/link"
      unless?: Record<string, string[]>;
    };

type Options = [
  {
    components?: string[];               // default: ["**/components/ui/**"]
    elements?: Record<string, Entry>;    // merged over the default map
    allow?: string[];                    // default: []
  },
];
```

- `components`: globs for the component folders, relative to ESLint's working directory. `shadcn()` passes its own `components` option here. Folders named `node_modules` and folders that start with `.` are skipped.
- `elements`: entries by element name, merged over the default map. An entry replaces the default for that element, so `input: "input"` drops the `type="hidden"` exemption. `false` drops the element. A `use` entry always reports, whether or not the folder has a file: use it for framework components, such as `a: { use: "Link", from: "next/link" }`.
- `unless`: attribute values that make an element harmless, such as `{ type: ["hidden"] }`. Only a static string counts: `type="hidden"`, `type={"hidden"}` or `` type={`hidden`} ``.
- `allow`: file globs, relative to ESLint's working directory, where the rule does nothing. It supports `**`, `*`, `?`, `[...]` and `{a,b}`. Use it for a file that must stay plain, such as a Next.js `global-error.tsx` that renders without the app shell.

ESLint rejects an element name that is not lower case, an entry with both `component` and `use`, and an empty object.

## With shadcn()

```js
...shadcn({
  components: ["apps/web/src/app/_components/ui/**"],
  rawElements: {
    elements: { a: { use: "Link", from: "next/link" } },
    allow: ["apps/web/src/app/global-error.tsx"],
  },
}),
```

`rawElements` takes `false`, a severity, or an object with `severity`, `elements`, `allow` and `components`. It inherits the factory's `severity` unless it sets its own. See [shadcn.md](shadcn.md).

## Limitations

- JSX only. `React.createElement("button")` and Vue or Svelte templates are not checked.
- The folder is scanned once per process and again when a folder that held components changes. A new component folder that did not exist at the first scan is seen after a restart.
- A spread, such as `<input {...hidden} />`, is not read, so it cannot exempt the element.
