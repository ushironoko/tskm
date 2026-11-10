# Compare

Measured by `bun src/run.ts` in `bench/compare`. Procedure and library calls are in `README.md`.

## Run

- When: 2026-11-10T00:49:31.778Z
- Agreement: 2,062 inputs (162 generated emails valid), 0 mismatches across 6 libraries and 1 reference entry (`src/agreement.ts`, checked before timing)
- Machine: Intel(R) Xeon(R) Processor, 8 cores, 16,779,689,984 bytes RAM
- Kernel: Linux version 6.12.113+ (root@73a7e9a344aa) (gcc (Debian 12.2.0-14+deb12u1) 12.2.0, GNU ld (GNU Binutils for Debian) 2.40) #1 SMP PREEMPT_DYNAMIC Fri Nov  6 22:36:28 UTC 2026
- Bun: 1.3.13
- esbuild: 0.28.2 (minify, tree-shake, gzip level 9)
- typescript: 6.0.3 (`tsc`)
- @typescript/native-preview: 7.0.0-dev.20260707.2 (`tsgo`)
- Copies for type instantiations: 100
- Speed: each library in a fresh process; warmup 100,000 per payload, then 5 interleaved rounds of 100,000 valid and 100,000 invalid parses. Table: median, with min – max over rounds.
- Load average (1, 5, 15 min): before speed 1.07 5.00 6.76; after speed 7.74 6.04 6.99
- Memory parses: 50,000

## Versions

- tskm: 0.3.0
- zod: 4.6.7
- valibot: 1.5.0
- arktype: 2.2.9
- typebox: 1.4.3
- effect: 4.1.2

## Memory

Bytes unless noted. `baseline` imports no library and parses nothing. Heap is the JSC heap size from `bun:jsc` (`heapStats().heapSize`) after a forced GC. Live objects is `heapStats().objectCount` after the same GC. Peak heap is sampled every 1,024 parses. Peak RSS is `VmHWM`. Each row is one fresh process.

| library | heap after load | live objects after load | heap after 50,000 parses + GC | live objects after parses + GC | peak heap (sampled) | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1,002,853 | 9,492 | 1,017,821 | 9,507 | 1,002,853 | 52,158,464 |
| tskm | 1,142,382 | 10,741 | 1,301,334 | 10,883 | 1,324,583 | 98,299,904 |
| zod | 2,418,213 | 22,860 | 2,895,018 | 23,370 | 2,997,721 | 119,578,624 |
| valibot | 1,196,694 | 11,249 | 1,345,016 | 11,399 | 1,196,694 | 95,563,776 |
| arktype | 13,168,480 | 103,744 | 13,387,606 | 103,612 | 13,168,480 | 124,272,640 |
| typebox | 3,693,301 | 33,802 | 4,443,105 | 34,502 | 4,774,435 | 183,910,400 |
| effect | 5,004,524 | 41,329 | 5,589,702 | 42,239 | 5,675,615 | 134,725,632 |

## Speed

ops/s. Valid input is the shared payload. Invalid input fails every constraint group. Each cell is the median over the rounds, with the min – max range below it in the next column.

| library | valid ops/s | valid min – max | valid ns/op | invalid ops/s | invalid min – max |
| --- | ---: | ---: | ---: | ---: | ---: |
| tskm | 1,451,658 | 1,175,843 – 1,531,409 | 688.9 | 824,904 | 619,071 – 833,872 |
| zod | 1,158,078 | 1,080,587 – 1,283,222 | 863.5 | 487,822 | 468,902 – 501,352 |
| valibot | 1,607,007 | 666,412 – 1,718,744 | 622.3 | 688,800 | 598,966 – 737,225 |
| arktype | 6,295,173 | 746,043 – 6,681,996 | 158.9 | 52,241 | 30,241 – 53,048 |
| typebox | 119,941 | 86,272 – 127,052 | 8337.4 | 79,034 | 55,237 – 81,332 |
| effect | 789,930 | 702,887 – 837,301 | 1265.9 | 297,910 | 287,687 – 317,079 |

## Bundle gzip

One entry per library: `parse` from `src/libs/<name>.ts`, esbuild minify and tree-shake, gzip level 9. `zod-mini` is zod's small-bundle entry, shown for reference; the speed, memory and type tables use the classic `zod`.

| library | raw bytes | gzip bytes |
| --- | ---: | ---: |
| tskm | 7,412 | 2,615 |
| zod | 90,981 | 26,689 |
| valibot | 6,404 | 2,140 |
| arktype | 156,826 | 48,195 |
| typebox | 143,080 | 36,462 |
| effect | 79,419 | 26,489 |
| zod-mini (reference) | 20,261 | 6,894 |

## Type instantiations

100 copies of the schema in one project, each checker run 3 times. `skipLibCheck` is on. Instantiation counts are identical across the runs (checked). Check time is the median of the runs, in milliseconds, from `--extendedDiagnostics`.

| library | tsc instantiations | tsc check ms | tsgo instantiations | tsgo check ms |
| --- | ---: | ---: | ---: | ---: |
| tskm | 21,606 | 530 | 21,605 | 64 |
| zod | 22,046 | 340 | 21,594 | 40 |
| valibot | 189,511 | 1,290 | 189,124 | 226 |
| arktype | 919,418 | 2,570 | 895,666 | 452 |
| typebox | 38,058 | 390 | 38,052 | 37 |
| effect | 20,855 | 520 | 20,855 | 43 |
