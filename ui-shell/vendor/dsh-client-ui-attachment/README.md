# dsh-client-ui-attachment source snapshot

This directory vendors `packages/client/ui-attachment/src` from
`deepseek-ai/deepseek-harness` tag `dsh-v0.1.1-rc.2`
(`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`).

Since 0.1.1 the package root is a host-side stub: the attachment atoms
(`DropOverlay` and friends) live at the source root while the plugin half
moved to `src/client/` and ships as a styled Host-served fetch bundle.
`ui-shell`'s own upload dock imports `DropOverlay` from this snapshot
directly (relative import, keeping the real CSS Module class names); the
official composer/message attachment UI arrives through the client plugin
graph and needs no aliasing.

Keep this snapshot and the pinned dsh client package versions in sync. The
root version check and every `ui-shell` build reject a mismatch recorded in
this directory's `package.json`.
