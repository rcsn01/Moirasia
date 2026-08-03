# @moirasia/ui-react

The source-owned shadcn component layer for Moirasia React applications. It uses
the Base UI Nova preset, neutral CSS-variable theming, Lucide icons, and a local
Geist Sans font. Consumers import component source through the published
subpaths and include `@moirasia/ui-react/styles.css` once at their renderer
entry point.

## Updating components

The generated source is intentionally customized and reviewed like application
code. The workspace pins shadcn CLI `4.16.1`. Inspect an update with
`pnpm --filter @moirasia/ui-react exec shadcn add <component> --diff` or
`pnpm --filter @moirasia/ui-react exec shadcn add <component> --dry-run`. Merge upstream changes
intentionally; never use an overwrite flag against customized components.
Finish with `pnpm typecheck` and `pnpm test` from the repository root.
