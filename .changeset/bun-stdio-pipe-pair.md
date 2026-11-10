---
"@tskm/compiler": patch
---

Under Bun, the checker's sync channel now stops the checker and throws `tskm: could not identify the checker's stdio pipes` unless its spawn opens exactly two new pipes or sockets. Taking the two lowest of three or more could hand stdin or stdout the wrong descriptor.
