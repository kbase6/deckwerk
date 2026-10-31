# types

## Overview

Ambient TypeScript declarations for third-party modules that ship no types.
There is no runtime code here. The only file, `katex-auto-render.d.ts`,
types `katex/contrib/auto-render`.

## Interface

- `declare module 'katex/contrib/auto-render'` (`katex-auto-render.d.ts`):
  default export
  `renderMathInElement(element: HTMLElement, options?: AutoRenderOptions): void`.
- `AutoRenderOptions` (module-local, not exported):
  `{delimiters?: {left, right, display}[]; throwOnError?: boolean; strict?: boolean | 'ignore' | 'warn' | 'error'}`.

## Invariants

- Only `delimiters`, `throwOnError` and `strict` are declared. Passing any
  other auto-render option fails type-checking until it is added here.
- Declaration files only: nothing here may emit JavaScript.

## Side Effects

- None.

## Verification

- Run: `npm run typecheck`
- Full suite: `npm test`
