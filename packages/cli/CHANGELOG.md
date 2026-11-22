# Changelog

## [0.1.1](https://github.com/joberthel/ludd/compare/cli-v0.1.0...cli-v0.1.1) (2026-11-22)


### Bug Fixes

* add repository metadata to package.json files for all packages ([c68dad5](https://github.com/joberthel/ludd/commit/c68dad5fcbb6a93312fc88ea346e255b4330f768))
* restore pastel dependency in package.json and pnpm-lock.yaml ([bde5dbd](https://github.com/joberthel/ludd/commit/bde5dbd23146734b20c34bf36c31823220d3ef37))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/agents bumped to 0.1.1
    * @luddjs/core bumped to 0.1.1
    * @luddjs/environments bumped to 0.1.1
    * @luddjs/guardrails bumped to 0.1.1

## [0.1.0](https://github.com/joberthel/ludd/compare/cli-v0.0.1...cli-v0.1.0) (2026-11-22)


### Features

* add CLI status and detached gate controls ([9740f46](https://github.com/joberthel/ludd/commit/9740f46b235ee9d1809c279981f2370b7aa56444))
* add dedicated interactive step mode with MCP ask_user and Ink UI ([ee3c4ea](https://github.com/joberthel/ludd/commit/ee3c4eac304a0eb25b709b9ef16830ce2b81c08d))
* add dedicated run resume command ([9d3c0d7](https://github.com/joberthel/ludd/commit/9d3c0d70765eadba4a215558c852d95b7b226763))
* add interactive split-pane CLI dashboard and question modal ([91a4482](https://github.com/joberthel/ludd/commit/91a448223f3fce40292a3ee872c1bac35be6688c))
* **cli:** add right-pane thinking stream, status circles, and guardrail output ([f8b1849](https://github.com/joberthel/ludd/commit/f8b18491f198a540cd7f498c45c9d68e82d4bca8))
* **cli:** add run cleanup controls ([1e2f147](https://github.com/joberthel/ludd/commit/1e2f14761c8e23ffab93fa019575f6ec0b87402d))
* **cli:** migrate CLI framework to Pastel, Ink, React, and @inkjs/ui ([093bc4c](https://github.com/joberthel/ludd/commit/093bc4cebca2bd3f074668ead47d7898e9572a7c))
* **cli:** render human review and retry gates with @inkjs/ui in TTY mode ([062e8ef](https://github.com/joberthel/ludd/commit/062e8efd7f7d48184579ae7c723a39ac5c376eeb))
* **cli:** render live workflow progress through a unified Ink UI ([91191fe](https://github.com/joberthel/ludd/commit/91191fe6e87fdea1b4cce28b5c927766021fffb0))
* **cli:** stream formatted agent output by default in LiveRunTailer ([0f8469b](https://github.com/joberthel/ludd/commit/0f8469b16fe48986d23084e65e87918994bd387c))
* **core,cli:** restrict human_review gates to pass and fail ([c14525a](https://github.com/joberthel/ludd/commit/c14525abf491c9656a4db14b74cfc6e5c746fe04))
* **core:** add allowOther option to select questions with default true in ask_user ([4049afc](https://github.com/joberthel/ludd/commit/4049afc06cfad442b100bae27b9bbb32a9f62b53))
* display runId on right side of CLI header bar ([1f19ae8](https://github.com/joberthel/ludd/commit/1f19ae88d0df6bf0d6b9b9e4247e093ce1290378))
* **guardrails,core,cli:** add optional guardrail name support and inline CLI rendering ([59c057a](https://github.com/joberthel/ludd/commit/59c057aa4422fac8a095a3b72385fb2d62178b8e))
* implement foreground CLI run ([4b6b7fb](https://github.com/joberthel/ludd/commit/4b6b7fbb0118def112d3409b4bd408835ba425a1))
* keep TTY dashboard open after run finishes or fails ([36791d5](https://github.com/joberthel/ludd/commit/36791d535a9be9e8cb4972837733f52400782360))
* update publish configuration to set access to public for all packages ([62f7b0e](https://github.com/joberthel/ludd/commit/62f7b0eb2697874cf6400da1778c28117b02fa83))


### Bug Fixes

* add black background color to CLI QuestionModal ([56e4218](https://github.com/joberthel/ludd/commit/56e4218e555d4791f55ffdbb669ff7c0330a7f36))
* **agents:** guide structured output submission ([d1c0b31](https://github.com/joberthel/ludd/commit/d1c0b318fef7f688b640d85b2cf6958db9d72f81))
* **cli:** abort inline gate prompt when run terminates ([2e9a7db](https://github.com/joberthel/ludd/commit/2e9a7db8711482afa13b7b332072778020f6675e)), closes [#80](https://github.com/joberthel/ludd/issues/80)
* **cli:** add blank line between question and answer input ([6721265](https://github.com/joberthel/ludd/commit/672126540639c39350119ef28a189f5f9b70d06c))
* **cli:** avoid dropping partial JSONL lines and splitting multi-byte UTF-8 in LiveRunTailer ([12f106f](https://github.com/joberthel/ludd/commit/12f106f4e9e30822691e964ad80d69063c0b8bbb)), closes [#67](https://github.com/joberthel/ludd/issues/67)
* **cli:** deduplicate watchForGate, skip in worker mode, and handle invalid gate prompt input ([ee33212](https://github.com/joberthel/ludd/commit/ee332122df3aed63981c20cd18c1f0cd165ac783)), closes [#70](https://github.com/joberthel/ludd/issues/70)
* **cli:** flush final events when stopping tailer ([3c2ad52](https://github.com/joberthel/ludd/commit/3c2ad522337fb5f18844820350581a37f24f2e6c))
* **cli:** print error details for failed ledger events in LiveRunTailer ([07b4c17](https://github.com/joberthel/ludd/commit/07b4c179ab85df9068daffe8a71658553ae7dba0))
* **cli:** switch to tsdown for bundling ([d200ba4](https://github.com/joberthel/ludd/commit/d200ba44d4e88c7b56bf196ee21c45fc99d1ad15))
* **cli:** validate gate action input and expose skip in human_review ([af7a924](https://github.com/joberthel/ludd/commit/af7a9249d2430f645a80d4f0dbc6542745de3f08)), closes [#81](https://github.com/joberthel/ludd/issues/81)
* preserve question modal input state when minimized via Ctrl+B ([4b92852](https://github.com/joberthel/ludd/commit/4b92852064090f2e855b91d9ebac08759ff62a85))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @luddjs/agents bumped to 0.1.0
    * @luddjs/core bumped to 0.1.0
    * @luddjs/environments bumped to 0.1.0
    * @luddjs/guardrails bumped to 0.1.0
