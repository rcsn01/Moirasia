# Moirasia

Moirasia is a macOS controller for the standalone Amove, Vox, Exithibition, and Bonded applications. It never embeds or runs product content: the Apps page discovers installed bundles, opens or focuses them, reports running state, and requests graceful termination. Closing Moirasia leaves every product app running.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

The four product repositories live under `apps/` and keep their own package manager locks and verification commands. `@moirasia/desktop-shell` provides the shared 36px macOS chrome, adaptive navigation, page/content-header layouts, atomic cross-process appearance registry, chrome-only window options, and bundle-owned headless login-item protocol.

## Application control

The packaged AppKit helper uses Launch Services and `NSWorkspace` to resolve fixed bundle identifiers, inspect running applications, launch or activate them, request normal termination, and open Login Items settings. Command+1 through Command+4 open or focus Amove, Vox, Exithibition, and Bonded respectively.

Each standalone bundle accepts one headless command without creating product windows or starting its runtime:

```text
--moirasia-control=login-item:get
--moirasia-control=login-item:set:on
--moirasia-control=login-item:set:off
```

Appearance is stored in `Application Support/Moirasia/appearance.json`. Values for Moirasia and each app remain independent, update live across running processes, and can be changed together from Moirasia Settings.
