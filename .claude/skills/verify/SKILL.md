---
name: verify
description: >-
  Use when asked to check, confirm, test, look at, screenshot, or verify that a change
  actually works or looks right in the running app or browser — "does this work", "does it
  look right", "show me", "take a screenshot", "run the app". Also use whenever a change
  affects layout, visuals, 3D positioning, lighting, camera, animation or physics, where unit
  tests and type checking cannot confirm the outcome. Covers launching the dev server and
  driving the page with Playwright.
---

# Verifying a change in the running app

Reading values and doing the arithmetic in your head is not a substitute for looking. If a
change has a visual outcome, look at it.

## Launch

Start the dev server exactly as **Dev server** under Project facts says, with its fixed port.
A fixed, strict port matters: a server that silently moves to the next free port makes every
hardcoded URL point at the wrong app. Work out the URL from **Routes** under Project facts.

## Drive it

Write the script **outside** the repository and import Playwright from the repository's
`node_modules` by absolute path, or from a throwaway install, so no stray files are left:

```ts
import { chromium } from '<repo>/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:<port>/<route>')
await page.waitForLoadState('networkidle')
await page.screenshot({ path: '/tmp/verify.png' })
await browser.close()
```

Screenshots go to a temporary directory, never into the repository. Then read the image —
most agent tools render it inline.

## Canvas and 3D

- A full-viewport canvas intercepts pointer events, so `locator.click()` on overlaid buttons
  times out; use `locator.evaluate((element) => element.click())`.
- Scenes that load models asynchronously need several seconds before they exist; wait for a
  known signal or a fixed delay the repository documents.
- Take a **second angle** by dragging on the canvas: the default angle shows front/back and
  left/right placement, a top-down angle shows alignment. Shadows read as height.
- For animation or physics, take several shots with waits between them; one frame cannot
  tell falling from floating.

## Gotchas

- Restart the dev server after any git operation that rewrites files (`stash`, `checkout`,
  `rebase`): bundlers keep serving the transform they already have, and the screenshot
  disproves a change that is actually correct.

## Definition of done

You looked at the result and it shows what you claimed. If the screenshot is unchanged after a
fix, the assumption behind the fix is probably wrong — go back to the underlying values rather
than screenshotting the same change again. Stop the dev server if you started it.
