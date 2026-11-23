# Changelog

## [0.1.1](https://github.com/joberthel/ludd/compare/environments-v0.1.0...environments-v0.1.1) (2026-11-22)


### Bug Fixes

* add repository metadata to package.json files for all packages ([c68dad5](https://github.com/joberthel/ludd/commit/c68dad5fcbb6a93312fc88ea346e255b4330f768))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/core bumped to 0.1.1

## [0.1.0](https://github.com/joberthel/ludd/compare/environments-v0.0.1...environments-v0.1.0) (2026-11-22)


### Features

* **core:** physical dangerMode enforcement & .harness/runs/ mount protection (ADR-0009) ([be523bd](https://github.com/joberthel/ludd/commit/be523bd1cdc4883e441be9d1c17d24f052b68e37))
* **environments:** default-deny credential isolation & explicit secret whitelisting (ADR-0007) ([9531f24](https://github.com/joberthel/ludd/commit/9531f24b92798b1d3f4e2ceb6f1e8a12ce68068c))
* **environments:** dockerWorktreeEnv container lifecycle, host-bridge MCP routing & rehydration ([43e19f9](https://github.com/joberthel/ludd/commit/43e19f968df962d1e71b0ea965dfc80a8ae49110))
* **environments:** dynamic env: (ctx) =&gt; ... resolution & ephemeral host port isolation ([896c8d5](https://github.com/joberthel/ludd/commit/896c8d5da2ddeb0cbedd9db3d96614f133d8eba2))
* **environments:** gitWorktreeEnv adapter, per-run worktree provisioning & cross-step reuse ([f64272e](https://github.com/joberthel/ludd/commit/f64272e99f3f33292d20389adb5aed4d8dca63c6))
* **environments:** safely delete merged branch on gitWorktreeEnv teardown ([f318517](https://github.com/joberthel/ludd/commit/f318517c2a017a80093853d1225b74f459a26895))
* **environments:** scaffold @luddjs/environments (hostEnv()) & execGuardrail ([c2272a4](https://github.com/joberthel/ludd/commit/c2272a44bbdaa326b390a0928b2a3d03f3025957)), closes [#28](https://github.com/joberthel/ludd/issues/28)
* update publish configuration to set access to public for all packages ([62f7b0e](https://github.com/joberthel/ludd/commit/62f7b0eb2697874cf6400da1778c28117b02fa83))


### Bug Fixes

* **agents,environments:** resolve host vs. container path mismatch in piAgent with docker-worktree ([cbf5a4e](https://github.com/joberthel/ludd/commit/cbf5a4e6cd3ca81b47d0e70e93b25de9d79ef090)), closes [#63](https://github.com/joberthel/ludd/issues/63)
* **core,agents,environments:** extract realpathNearest with root termination guard ([744acd3](https://github.com/joberthel/ludd/commit/744acd37d51091e820acbe988e5451da0daa3fa3)), closes [#77](https://github.com/joberthel/ludd/issues/77)
* **core,agents,environments:** fix rehydration env isolation, cwd, and signal spread ([e580dcb](https://github.com/joberthel/ludd/commit/e580dcbd93b7714d3c3c7968b4f81f97e6f73f21)), closes [#78](https://github.com/joberthel/ludd/issues/78)
* **environments:** await hostEnv async initialization in provision() to avoid race condition ([9d70102](https://github.com/joberthel/ludd/commit/9d70102be0e35d9fcb84ac1429d33ffa81a92fac)), closes [#64](https://github.com/joberthel/ludd/issues/64)
* **environments:** prevent ancestor mount bypass and check nearest realpath in validateHostMountPath ([99d90af](https://github.com/joberthel/ludd/commit/99d90af3ae2ad775c5a21ee2c59017c0362aef27)), closes [#65](https://github.com/joberthel/ludd/issues/65)
* **environments:** strip trailing slashes from gitWorktreeEnv branchPrefix ([ce21aa7](https://github.com/joberthel/ludd/commit/ce21aa763f6de81e2fbc425d91504e52c051bad6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/core bumped to 0.1.0
