# Changelog

## [0.1.2](https://github.com/joberthel/ludd/compare/guardrails-v0.1.1...guardrails-v0.1.2) (2026-11-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/core bumped to 0.2.0
  * devDependencies
    * @luddjs/agents bumped to 0.2.0

## [0.1.1](https://github.com/joberthel/ludd/compare/guardrails-v0.1.0...guardrails-v0.1.1) (2026-11-22)


### Bug Fixes

* add repository metadata to package.json files for all packages ([c68dad5](https://github.com/joberthel/ludd/commit/c68dad5fcbb6a93312fc88ea346e255b4330f768))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/agents bumped to 0.1.1
    * @luddjs/core bumped to 0.1.1

## [0.1.0](https://github.com/joberthel/ludd/compare/guardrails-v0.0.1...guardrails-v0.1.0) (2026-11-22)


### Features

* **cli:** add right-pane thinking stream, status circles, and guardrail output ([f8b1849](https://github.com/joberthel/ludd/commit/f8b18491f198a540cd7f498c45c9d68e82d4bca8))
* **core:** beforeStep context collection, MCP log offloading & format-aware pagination ([9817659](https://github.com/joberthel/ludd/commit/9817659eba6ff872b8d50229ff2ff674bb050d0f)), closes [#29](https://github.com/joberthel/ludd/issues/29)
* **environments:** scaffold @luddjs/environments (hostEnv()) & execGuardrail ([c2272a4](https://github.com/joberthel/ludd/commit/c2272a44bbdaa326b390a0928b2a3d03f3025957)), closes [#28](https://github.com/joberthel/ludd/issues/28)
* **guardrails,core,cli:** add optional guardrail name support and inline CLI rendering ([59c057a](https://github.com/joberthel/ludd/commit/59c057aa4422fac8a095a3b72385fb2d62178b8e))
* **guardrails:** agentGuardrail with bodySchema, fresh sessionId & environment reuse ([f0726b3](https://github.com/joberthel/ludd/commit/f0726b3406d9d7f77429e631c93e7738f04e3125)), closes [#30](https://github.com/joberthel/ludd/issues/30)
* **guardrails:** default agentGuardrail to piAgent ([8533799](https://github.com/joberthel/ludd/commit/8533799a6d4d17ed1a8f1d35519eece125e3f741)), closes [#50](https://github.com/joberthel/ludd/issues/50)
* **guardrails:** humanReviewGuardrail in afterStep pass/fail self-healing loop ([b1e1bf8](https://github.com/joberthel/ludd/commit/b1e1bf81a53bff99b7d3b58f7514ad105c1d90fd))
* **guardrails:** humanReviewGuardrail in beforeStep, 0%-CPU gate waiting & gate.resolve ([32f0fff](https://github.com/joberthel/ludd/commit/32f0fff8ab5ec52f60005951c6df23732ac7bbb0))
* **guardrails:** scaffold @luddjs/guardrails, fnGuardrail & afterStep full-chain restart from index 0 ([aacf8e9](https://github.com/joberthel/ludd/commit/aacf8e9b7ffc98b07018190f56b96435b7ea3c97)), closes [#27](https://github.com/joberthel/ludd/issues/27)
* update publish configuration to set access to public for all packages ([62f7b0e](https://github.com/joberthel/ludd/commit/62f7b0eb2697874cf6400da1778c28117b02fa83))


### Bug Fixes

* **environments:** await hostEnv async initialization in provision() to avoid race condition ([9d70102](https://github.com/joberthel/ludd/commit/9d70102be0e35d9fcb84ac1429d33ffa81a92fac)), closes [#64](https://github.com/joberthel/ludd/issues/64)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/agents bumped to 0.1.0
    * @luddjs/core bumped to 0.1.0
