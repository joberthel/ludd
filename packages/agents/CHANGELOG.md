# Changelog

## [0.1.1](https://github.com/joberthel/ludd/compare/agents-v0.1.0...agents-v0.1.1) (2026-11-22)


### Bug Fixes

* add repository metadata to package.json files for all packages ([c68dad5](https://github.com/joberthel/ludd/commit/c68dad5fcbb6a93312fc88ea346e255b4330f768))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/core bumped to 0.1.1

## [0.1.0](https://github.com/joberthel/ludd/compare/agents-v0.0.1...agents-v0.1.0) (2026-11-22)


### Features

* add dedicated interactive step mode with MCP ask_user and Ink UI ([ee3c4ea](https://github.com/joberthel/ludd/commit/ee3c4eac304a0eb25b709b9ef16830ce2b81c08d))
* **agents:** add authenticated MCP tool bridge and submit_step_output ([66f77cb](https://github.com/joberthel/ludd/commit/66f77cbaf727c49e6595838ca32840240c7ce89d)), closes [#49](https://github.com/joberthel/ludd/issues/49)
* **agents:** add piAgent core adapter with session continuity and live streaming ([f5ac00f](https://github.com/joberthel/ludd/commit/f5ac00f8de61f27933e8f2887072cbbe444db27f)), closes [#52](https://github.com/joberthel/ludd/issues/52)
* **agents:** add read-only sandbox and symlink-safe workspace path guard ([0bdc454](https://github.com/joberthel/ludd/commit/0bdc45411fe720a557a4f03e23bfe0cd21649296)), closes [#47](https://github.com/joberthel/ludd/issues/47)
* **agents:** add workspace-write tool_call guard and docker bash delegation ([c1ab138](https://github.com/joberthel/ludd/commit/c1ab13836e6a2f25a4c1e39efee67a01ef09fec8)), closes [#48](https://github.com/joberthel/ludd/issues/48)
* **agents:** resolve string model patterns in piAgent ([bae39a5](https://github.com/joberthel/ludd/commit/bae39a596aeee6e0c1822e456b34c02dc9072e7e))
* **agents:** scaffold @ludd/agents, AgentRunner contract & mockAgent() ([d8af1ae](https://github.com/joberthel/ludd/commit/d8af1ae619db2e23e0bfc35a449ec21e330fbc8f)), closes [#15](https://github.com/joberthel/ludd/issues/15)
* **core:** compile-time type inference for defineHarness() & matrix ([1f1637f](https://github.com/joberthel/ludd/commit/1f1637f3834014446959ebfd9f7ee3032750c33d)), closes [#24](https://github.com/joberthel/ludd/issues/24)
* **core:** declarative sessionId capture, output merging & session resumption ([c88dbdb](https://github.com/joberthel/ludd/commit/c88dbdb79b0ad67a05a49c3c1c1707a39cf9f5e0)), closes [#16](https://github.com/joberthel/ludd/issues/16)
* **core:** embedded HTTP/SSE MCP server & scoped artifact store ([432e238](https://github.com/joberthel/ludd/commit/432e2381c878c5c5b0060265f8f241ba595c4f14)), closes [#21](https://github.com/joberthel/ludd/issues/21)
* **core:** per-session telemetry stream splitting & agent.stream.linked event ([0506f94](https://github.com/joberthel/ludd/commit/0506f94626121e93cd755bf360ae2baaccffadf9)), closes [#17](https://github.com/joberthel/ludd/issues/17)
* **core:** self-healing outputSchema retry loop & maxTotalTurns circuit breaker ([4980da9](https://github.com/joberthel/ludd/commit/4980da9769ea33be2634f616d59c4d09043c10c9)), closes [#18](https://github.com/joberthel/ludd/issues/18)
* **environments:** scaffold @ludd/environments (hostEnv()) & execGuardrail ([c2272a4](https://github.com/joberthel/ludd/commit/c2272a44bbdaa326b390a0928b2a3d03f3025957)), closes [#28](https://github.com/joberthel/ludd/issues/28)
* update publish configuration to set access to public for all packages ([62f7b0e](https://github.com/joberthel/ludd/commit/62f7b0eb2697874cf6400da1778c28117b02fa83))


### Bug Fixes

* **agents,environments:** resolve host vs. container path mismatch in piAgent with docker-worktree ([cbf5a4e](https://github.com/joberthel/ludd/commit/cbf5a4e6cd3ca81b47d0e70e93b25de9d79ef090)), closes [#63](https://github.com/joberthel/ludd/issues/63)
* **agents:** dispose Pi sessions after each turn ([d75ec31](https://github.com/joberthel/ludd/commit/d75ec31d251128957a419aae8474c2919ec7463d))
* **agents:** forward step.dangerMode to piAgent workspaceWriteExtension ([d510953](https://github.com/joberthel/ludd/commit/d51095394eb6a23eca884fca2566cfbb00ce3946)), closes [#61](https://github.com/joberthel/ludd/issues/61)
* **agents:** guide structured output submission ([d1c0b31](https://github.com/joberthel/ludd/commit/d1c0b318fef7f688b640d85b2cf6958db9d72f81))
* **agents:** prevent dangerMode from bypassing host workspaceWriteExtension path guard ([001a0ca](https://github.com/joberthel/ludd/commit/001a0ca9cabf13e5537febfcbd3de01a586a7769)), closes [#76](https://github.com/joberthel/ludd/issues/76)
* **agents:** surface provider errors from Pi assistant messages ([a7c35e8](https://github.com/joberthel/ludd/commit/a7c35e8ef9160ee273d2dba6f08d86b203a5bb0f))
* **core,agents,environments:** extract realpathNearest with root termination guard ([744acd3](https://github.com/joberthel/ludd/commit/744acd37d51091e820acbe988e5451da0daa3fa3)), closes [#77](https://github.com/joberthel/ludd/issues/77)
* **core,agents,environments:** fix rehydration env isolation, cwd, and signal spread ([e580dcb](https://github.com/joberthel/ludd/commit/e580dcbd93b7714d3c3c7968b4f81f97e6f73f21)), closes [#78](https://github.com/joberthel/ludd/issues/78)
* serialize concurrent ask_user calls and remove MCP client timeout ([b090b0a](https://github.com/joberthel/ludd/commit/b090b0a997dfc0ce7b3e436ec2c7408f0ab62644))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/core bumped to 0.1.0
