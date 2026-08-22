# dsh-client-ui-primitives source snapshot

This directory vendors `packages/client/ui-primitives/src` from
`deepseek-ai/deepseek-harness` tag `dsh-v0.1.1-rc.2`
(`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`).

The published `@deepseek-ai/dsh-client-ui-primitives@0.1.1-rc.2` JavaScript
replaces CSS Module imports with empty objects. The official web shell builds
this package from source, so custom consumers otherwise receive the component
logic without its generated class names. `ui-shell/vite.config.ts` aliases the
platform singleton to this version-matched snapshot so every official client
plugin receives the styled implementation.

Keep this snapshot and the pinned dsh client package versions in sync.
The root `npm run check:dsh-version` and every `ui-shell` build reject a
version mismatch recorded in this directory's `package.json`.
