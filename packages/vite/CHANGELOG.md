# @tskm/vite

## 0.0.9

### Patch Changes

- c96c3b9: Report static JSON Schema failures from the Vite plugin. An incremental watch rebuild keeps those errors on the generate result, and the plugin prints them as errors so a removed literal is not a silent success.
- Updated dependencies [30fc0bd]
- Updated dependencies [c96c3b9]
  - @tskm/compiler@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [21bfa96]
  - @tskm/compiler@0.6.0

## 0.0.7

### Patch Changes

- 41beb3c: Fix `vite dev` compiling schemas twice on startup and then ignoring file changes.

  The dev server starts the compiler watcher, which already generates once, and `buildStart` generated again. Dev startup now leaves that first pass to the watcher. `vite build` still generates once from `buildStart`. The watcher is no longer closed by the function `configureServer` returns, because Vite calls that function during startup, before `listen`.

- 3ebe97f: Generate schemas once when Vite builds more than one environment.

  `buildApp` runs `buildStart` for each environment, so a client and ssr build compiled the project twice. Environments that have not generated yet share that pass. The same environment's next build, including a `build --watch` rebuild of only that environment, compiles again. A file change that rebuilds client and ssr together still compiles once.

- Updated dependencies [0483e8f]
- Updated dependencies [29bb6d5]
- Updated dependencies [b450d8f]
- Updated dependencies [10a3f9b]
- Updated dependencies [6e76ac7]
- Updated dependencies [1b60eb8]
- Updated dependencies [0483e8f]
- Updated dependencies [d577165]
  - @tskm/compiler@0.5.0

## 0.0.6

### Patch Changes

- Updated dependencies [723e719]
  - @tskm/compiler@0.4.1

## 0.0.5

### Patch Changes

- Updated dependencies [830eca4]
- Updated dependencies [830eca4]
- Updated dependencies [830eca4]
- Updated dependencies [830eca4]
- Updated dependencies [830eca4]
- Updated dependencies [830eca4]
  - @tskm/compiler@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [b61e04a]
  - @tskm/compiler@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [ec19bc1]
  - @tskm/compiler@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [512f778]
  - @tskm/compiler@0.1.0
