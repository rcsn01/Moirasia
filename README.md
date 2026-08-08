# Moirasia

Moirasia is a macOS controller for the standalone Amove, Vox, and Exithibition applications. It never embeds or runs product content: the Apps page discovers installed bundles, opens or focuses them, reports running state, and requests graceful termination. Closing Moirasia leaves every product app running.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

The three product repositories live under `apps/` and keep their own package manager locks and verification commands. `@moirasia/desktop-shell` provides the shared 52px macOS app bar, appearance controls, atomic cross-process appearance registry, primary-window options, and bundle-owned headless login-item protocol.

## Application control

The packaged AppKit helper uses Launch Services and `NSWorkspace` to resolve fixed bundle identifiers, inspect running applications, launch or activate them, request normal termination, and open Login Items settings. Command+1, Command+2, and Command+3 open or focus Amove, Vox, and Exithibition respectively.

Each standalone bundle accepts one headless command without creating product windows or starting its runtime:

```text
--moirasia-control=login-item:get
--moirasia-control=login-item:set:on
--moirasia-control=login-item:set:off
```

Appearance is stored in `Application Support/Moirasia/appearance.json`. Values for Moirasia and each app remain independent, update live across running processes, and can be changed together from Moirasia Settings.
