# dsh-client-ui-attachment source snapshot

This directory vendors `packages/client/ui-attachment/src` from
`deepseek-ai/deepseek-harness` tag `dsh-v0.1.0-rc.7`
(`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`).

The published `@deepseek-ai/dsh-client-ui-attachment@0.1.0-rc.7` JavaScript
replaces CSS Module imports with empty objects. `ui-shell/vite.config.ts`
aliases the platform singleton to this version-matched source snapshot so the
official attachment rail, image gallery, lightbox, and drop overlay retain
their official layout and interaction styles.

Keep this snapshot and the pinned dsh client package versions in sync. The
root version check and every `ui-shell` build reject a mismatch recorded in
this directory's `package.json`.
