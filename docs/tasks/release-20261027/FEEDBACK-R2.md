# Final release correction round

The initial prepared release passed check but failed the normal hook's packed package test. Read-only diagnosis found the plugin's own metadata version at 0.19.0. Round 1 changed only that literal to 0.20.0. The packed fixture stays unchanged and now passes.

Round 1's normal hook then passed check but failed the rules suite, with 1210 of 1211 tests passing. The remaining failure is packages/rules/tests/exported-preset.test.mjs:21, which expects plugin.meta.version 0.19.0. Update that exact expectation to 0.20.0. Keep the full metadata equality assertion and every other preset assertion intact.

The parent inspected remaining references to 0.19.0 in rules tests, root tests and scripts. The others are historical local-publish examples and synthetic app-map package fixtures, not assertions of this plugin's current version. Do not replace them.

Complete the 34-path prepared version/pin/docs commit with normal hooks enabled. Preserve the owner's task documents unstaged. No source behavior, dependency, policy or suppression change is authorized. Keep the accepted version inventory unchanged. Run the focused exported-preset and packed-package tests, frozen install and pins; the normal commit hook must pass check and test.

This is release correction round 2. Any further failing gate stops automatic correction and must be reported. Do not merge or publish a red release.

Evidence: /home/kuba/.pi/agent/proof/house-rules/chore-release-framework-20261027/preparation-r0/failed-hook.log and preparation-r1/normal-hook-commit.log.
