# Moirasia

Moirasia is an app that contains other apps. This directory also
contains independent apps that share its UI.

## Integrated apps

Apps under `apps/integrated/` are intended to be integrated into
Moirasia. Their functionality can run inside Moirasia.

## Standalone apps

Apps under `apps/standalone/` are independent apps. They must not
be embedded in, launched by, or controlled by Moirasia.

They are placed here only so they can share Moirasia's UI packages.
Their presence in this directory does not make them part of
Moirasia.

Do not treat existing integrations that violate this boundary as
a pattern to follow.

## UI alignment

Moirasia, integrated apps, and standalone apps should keep their
UI aligned with each other.

Use shared UI packages and consistent controls, typography,
spacing, colors, and window chrome. Apps can have different layouts
to suit their functionality while following these shared conventions.

Make UI changes intended for all apps in the shared packages
rather than duplicating them across apps. Keep app-specific UI
within the app that owns it.

When changing shared UI, verify it in both integrated and
standalone contexts.
