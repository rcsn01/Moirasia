# Moirasia

Moirasia is an Electron 43 macOS host for independently built application modules. Amove, Vox, and Exithibition remain standalone applications in their own repositories under `apps/`; each app also builds a module artifact from the same canonical feature code.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm test:ownership
pnpm build
```

Opening a stopped module in development starts that repository's `module:dev` command. Its watcher emits a JSON readiness record containing the generated manifest path. Closing the module terminates the watcher; it never launches the standalone Electron or SwiftUI application.

## Production discovery

Standalone apps embed their module at `Contents/PlugIns/<id>.moirasia-module`. Moirasia locates fixed bundle identifiers through Launch Services, verifies the enclosing `Info.plist` identity and strict ad-hoc code seal, validates the versioned manifest and host API range, rejects links and escaping paths, verifies the payload hash, and atomically stages the artifact in its module cache before loading it.

These local-only builds deliberately disable hardened runtime and notarization. Ad-hoc signing detects post-build changes; it does **not** prove publisher identity. No Team ID check is made.

## Ownership and lifecycle

Moirasia owns only its shell, module SDK, lifecycle manager, discovery/cache machinery, generic native-view bridge, settings, and scoped host services. Product UI, business logic, native helpers, and product tests remain in their respective repositories. `pnpm test:ownership` prevents copied product source trees from returning here.

Multiple modules may run at once, but only one main surface is attached. Switching detaches a surface without stopping its module. Explicit close and ordered Moirasia shutdown call `canClose`, then module cleanup, then unconditional host-ledger cleanup for views, utility windows, IPC registrations, shortcuts, listeners, locks, and helper processes.

Both host and standalone adapters use `@moirasia/module-sdk`'s versioned data-directory lock. A standalone process refuses to start while its Moirasia module owns the data, and Moirasia never force-kills a standalone owner.

See [the dual-target architecture](docs/architecture/dual-target-modules.md) for the complete contract.
