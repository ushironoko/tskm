---
"@tskm/compiler": patch
---

Bun on macOS: the checker's sync channel finds its pipes through `/dev/fd` when `/proc/self/fd` does not exist, instead of throwing. Linux is unchanged.
