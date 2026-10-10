# HTTP server or API

Each line is a question to answer with a location in the code, not a yes from memory.

## Injection

- **SQL and NoSQL**: queries use parameters or a query builder; no input is concatenated into
  a query string; objects from request bodies are not passed as filters (`{ $gt: '' }`).
- **Commands**: `execFile` / `spawn` with an argument array and no `shell: true`; input never
  reaches `exec`, a shell string or a command's option position (`--upload-pack=...`). A
  value that must be an argument follows `--`.
- **Paths**: a path built from input is resolved and checked to stay inside its root
  (`resolve(root, input).startsWith(root + sep)`), and `..`, absolute paths and null bytes
  are refused.
- **Templates**: user input is a template's data, never the template.
- **Headers and logs**: input written into headers or log lines has CR and LF stripped.
- **Deserialisation**: no `eval`, `vm`, unsafe YAML loaders or `pickle` on input.

## Authentication and sessions

- **Every route** that is not deliberately public checks the session, and the public ones are
  in one visible list.
- **Cookies** holding a session are `HttpOnly`, `Secure` behind https, `SameSite=Lax` or
  stricter, and `__Host-` prefixed where possible.
- **Session ids** are random (`crypto.randomBytes`, not `Math.random`), rotated at sign-in, and
  expire.
- **Passwords** are hashed with argon2id, scrypt or bcrypt; secret comparisons use
  `timingSafeEqual`.
- **OAuth / OpenID**: `state` bound to the browser, PKCE, the redirect URI matched exactly,
  the allowlist or tenant checked after sign-in.
- **Tokens (JWT)**: the algorithm is fixed server-side, the signature and expiry are checked,
  `none` is refused.
- **Sign-in and other costly endpoints** are rate limited.

## Access control

- **Object ownership**: loading a record by id checks it belongs to the caller (IDOR).
- **Mass assignment**: bodies are parsed with a schema that lists the allowed fields; role,
  owner or price fields are never taken from the client.
- **Checks happen before side effects**, not after.

## Cross-site requests

- **CSRF**: state-changing requests are never GET; cookie-authenticated mutations check the
  `Origin` header, require a JSON content type, or carry a token.
- **CORS**: no reflected `Origin` with credentials; an allowlist of exact origins.
- **DNS rebinding** for services on localhost: the `Host` header is checked against an
  allowlist.

## Outbound requests (SSRF)

- A URL from input (webhooks, previews, importers) is fetched only if its host is on an
  allowlist, or at least resolves to a public address; private, loopback, link-local and
  cloud metadata addresses (`169.254.169.254`) are refused, and redirects are re-checked.

## Resource exhaustion

- **Body size** is limited; uploads have a size and type limit and are stored outside the
  web root, served with `Content-Disposition: attachment` unless they are safe images.
- **Unbounded memory**: caches, maps and queues keyed by anything a client controls have a
  cap or an expiry.
- **Regular expressions** run on input have no nested quantifiers that backtrack (ReDoS).
- **Pagination**: list endpoints cap the page size.

## Secrets and errors

- **Secrets** come from the environment or a secret store, never the repository; they are
  passed to child processes through the environment, not arguments.
- **Errors** returned to clients carry no stack traces, queries or secret values; logs redact
  known secrets.
- **Encryption at rest** uses an authenticated mode (AES-GCM, ChaCha20-Poly1305) with a random
  nonce per value.

## Headers

- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `Content-Security-Policy`
  or `frame-ancestors` for pages, and no `X-Powered-By` / `Server` version banners.
