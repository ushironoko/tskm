# Compare

Measured by `bun src/run.ts` in `bench/compare`. Procedure and library calls are in `README.md`.

## Run

- When: 2026-11-02T14:02:56.308Z
- Machine: Intel(R) Xeon(R) Processor, 4 cores, 16,780,574,720 bytes RAM
- Kernel: Linux version 6.12.94+ (root@d37620e8e974) (gcc (Debian 12.2.0-14+deb12u1) 12.2.0, GNU ld (GNU Binutils for Debian) 2.40) #1 SMP PREEMPT_DYNAMIC Thu Oct 29 00:09:04 UTC 2026
- Bun: 1.3.13
- esbuild: 0.28.2 (minify, tree-shake, gzip level 9)
- typescript: 6.0.3 (`tsc`)
- @typescript/native-preview: 7.0.0-dev.20260707.2 (`tsgo`)
- Copies for type instantiations: 100
- Speed: warmup 20,000, then 5 runs of 100,000, median
- Memory parses: 50,000

## Versions

- tskm: 0.3.0
- zod: 4.6.7
- valibot: 1.5.0
- arktype: 2.2.9
- typebox: 1.4.3
- effect: 4.1.2

## Memory

Bytes. `baseline` imports no library and parses nothing. `heap after load` is `heapUsed` after a forced GC. `peak RSS` is `VmHWM`.

| library | heap after load | heap after one parse | peak heap during parses | heap after parses + GC | peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 212,874 | 212,874 | 212,874 | 212,874 | 47,849,472 |
| tskm | 998,943 | 998,943 | 1,438,791 | 1,438,791 | 100,794,368 |
| zod | 998,157 | 998,157 | 2,729,557 | 2,729,557 | 117,501,952 |
| valibot | 998,163 | 998,163 | 1,254,627 | 1,254,627 | 93,282,304 |
| arktype | 998,947 | 998,947 | 998,947 | 998,947 | 128,802,816 |
| typebox | 2,208,693 | 2,208,693 | 4,260,652 | 4,260,652 | 161,415,168 |
| effect | 1,349,231 | 1,349,231 | 5,263,875 | 5,263,875 | 116,723,712 |

## Speed

ops/s, median. Valid input is the shared payload. Invalid input fails every constraint group.

| library | valid ops/s | valid ns/op | invalid ops/s |
| --- | ---: | ---: | ---: |
| tskm | 1,987,624 | 503.1 | 878,818 |
| zod | 1,575,729 | 634.6 | 480,405 |
| valibot | 2,111,026 | 473.7 | 788,482 |
| arktype | 10,651,611 | 93.9 | 56,765 |
| typebox | 165,669 | 6036.1 | 162,818 |
| effect | 1,159,203 | 862.7 | 1,056,627 |

## Bundle gzip

| library | raw bytes | gzip bytes |
| --- | ---: | ---: |
| tskm | 7,219 | 2,505 |
| zod | 90,868 | 26,614 |
| valibot | 6,124 | 2,071 |
| arktype | 156,718 | 48,135 |
| typebox | 142,888 | 36,366 |
| effect | 78,926 | 26,387 |

## Type instantiations

100 copies of the schema in one project. `skipLibCheck` is on. Check time is milliseconds from `--extendedDiagnostics`.

| library | tsc instantiations | tsc check ms | tsgo instantiations | tsgo check ms |
| --- | ---: | ---: | ---: | ---: |
| tskm | 30,423 | 860 | 35,964 | 76 |
| zod | 22,021 | 270 | 21,609 | 41 |
| valibot | 189,383 | 1,080 | 188,994 | 191 |
| arktype | 786,278 | 1,740 | 764,039 | 335 |
| typebox | 38,058 | 360 | 38,052 | 34 |
| effect | 20,855 | 290 | 20,855 | 38 |
