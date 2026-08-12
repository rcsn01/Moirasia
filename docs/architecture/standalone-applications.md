# Standalone application architecture

Moirasia is a controller, not a product host. Its renderer has only Apps and Settings pages and its main process talks to a small AppKit agent. Product windows, native helpers, shortcuts, utility windows, settings, and data remain owned by their app bundles.

The shared desktop shell supplies consistent primary-window chrome and appearance for Moirasia, Amove, Vox, Exithibition, and Bonded. `DesktopAppShell` owns the neutral 40px title bar; `DesktopNavigation` changes from a 220px sidebar to a horizontal row below 720px; `DesktopPage` preserves app-selected content widths and scrolling; and `DesktopContentHeader` holds product operations below the draggable chrome. Window dimensions remain controller-owned. Utility surfaces are intentionally excluded: Amove's shelf retains its compact borderless window and Vox's dictation overlay remains transparent, floating, and non-activating.

Login-item changes are executed by the target bundle through the versioned `--moirasia-control` protocol because macOS login services are scoped to the calling bundle. The command uses isolated Chromium data and exits after one JSON response.
