# no-hand-rolled-surface

Clients and agents reach an Alchemy Domain model only through a `Domain.Api` served with `@alchemy.run/domain/Http`, `/Ai` (MCP) or `/Cli`. Apps do not call Tool.make, Rpc.make or HttpApiEndpoint methods by hand.

The rule resolves actual Effect imports, including named aliases, namespace imports and the stable/RC paths. A local object with the same spelling is not an Effect builder. The default allow list is empty. A consumer can pass its own `allow` globs without widening the plugin preset.

Enable configs.workspace or workspaceConfig({appsDir,packagesDir}). It checks the same JS/TS extensions as recommended. Toolkit.make is not one of the banned calls. no-hand-run-effect and testing-export restrictions stay separate checks in the workspace preset.
