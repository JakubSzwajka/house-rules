# Framework release acceptance

1. Inspect the version inventory and all manifests. Confirm 21 public packages, new stable versions and exact internal dependency and peer pins. Confirm no external runtime or tool change.
2. Run frozen install, full check and test, the packed consumer, booking build and site build. Save command, log and exit status for each.
3. In a cold packed consumer, load the Node Host bridge and Express Host, check the required command-kind policy and WorkItems query descriptors. Keep write and unresolved query controls failing.
4. Open the release PR and inspect CI for its exact head. Merge only after every required check succeeds, using a merge commit.
5. Dispatch publish.yml on main once with publish=true. Watch verify and publish. Stop on a gate or publication failure; do not bypass or retry it.
6. Query every exact npm version. Check integrity, exact internal pins, provenance source commit, and package tags. Install the npm cohort in a cold consumer and confirm Node Host's bridge export and Express import work.
7. Deliver the verified {name: version} JSON to the Board/Trainer owner and Conductor. Keep app acceptance separate. Keep Verdaccio until the app owner confirms npm adoption.
