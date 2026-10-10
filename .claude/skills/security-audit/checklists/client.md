# Browser client

Each line is a question to answer with a location in the code, not a yes from memory.

## Script injection (XSS)

- **HTML sinks**: `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `srcdoc`, `Range.createContextualFragment`. Every one
  either takes a constant or goes through DOMPurify with a strict config. Data that is only
  text is rendered as text.
- **Markdown and rich text** (issue bodies, comments, README content) are rendered through a
  renderer with raw HTML off, or sanitised after rendering.
- **URLs from data** in `href`, `src`, `action`, `formaction` or `window.location`: only
  `https:`, `http:`, `mailto:` or relative; never `javascript:` or `data:` from input.
- **Code evaluation**: no `eval`, `new Function`, `setTimeout` with a string, or dynamic
  `import()` of a URL built from input.
- **SVG** from users is served as a file or an `<img>`, never inlined into the page.

## Navigation and messaging

- **Open redirects**: a `?next=`, `?redirect=` or `returnTo` value is checked against an
  allowlist of paths on this origin before navigating.
- **`postMessage`** handlers check `event.origin` against an exact allowlist, and senders pass
  an explicit target origin, never `'*'` with anything sensitive.
- **Links to other sites** opened in a new tab carry `rel="noopener noreferrer"`.

## Credentials in the browser

- **Tokens** live in `HttpOnly` cookies, not `localStorage` or `sessionStorage`, where any XSS
  can read them.
- **No secret in the bundle**: build-time public variables (`VITE_*`, `NEXT_PUBLIC_*`,
  `PUBLIC_*`) hold only what anyone may see.
- **No secrets in URLs**: tokens in query strings end up in history, logs and `Referer`.

## Hardening

- **Content Security Policy** is set by the server or proxy, without `unsafe-inline` for
  scripts where the framework allows it, and with `frame-ancestors` (or `X-Frame-Options`)
  to stop clickjacking.
- **Third-party scripts** from a CDN carry Subresource Integrity, or are bundled.
- **Prototype pollution**: deep-merging parsed JSON or query strings into objects rejects
  `__proto__`, `constructor` and `prototype` keys.

## Canvas, WebGL and assets

- **Models, textures and fonts from user URLs** are fetched only from allowed origins, and
  their size is capped before parsing; a huge or malformed file should fail, not freeze the
  tab.
- **Shaders or scene descriptions from users** are data, never evaluated as code.
