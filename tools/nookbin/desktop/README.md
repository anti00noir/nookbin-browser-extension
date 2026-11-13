# NookBin Desktop (reserved)

Placeholder for a future native port of NookBin. The browser extension lives in
[`../extension`](../extension); target-agnostic logic it depends on lives in
[`../../../packages/core`](../../../packages/core).

A native port would reuse `@nooksuite/core` (file storage abstraction, panel
geometry) with a desktop-specific storage backend and UI shell.
