# Moirasia

Moirasia is a macOS controller and feature host for Amove, Vox, Exithibition, and Bonded. The Apps page discovers standalone bundles, opens or focuses them, reports running state, and requests graceful termination. The suite can also run feature packages in-process; Exithibition is the first one.

## Development

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

The suite build compiles the Exithibition Swift helper, stages it, and packages the unsigned Moirasia app:

```sh
pnpm dist:mac
```

Exithibition remains buildable as a standalone app. Run its commands from the app directory:

```sh
pnpm -C apps/Exithibition install --ignore-workspace
pnpm -C apps/Exithibition dev
pnpm -C apps/Exithibition package:mac
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

In-suite features use the Moirasia bundle's macOS permissions. Microphone, accessibility, and screen-recording grants apply to the suite app, not to an individual product feature. Standalone builds keep their own bundle identity and permissions.
