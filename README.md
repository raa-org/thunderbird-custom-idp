[![Latest Release](https://img.shields.io/github/v/release/raa-org/thunderbird-custom-idp?sort=semver)](https://github.com/raa-org/thunderbird-custom-idp/releases/latest)


# Thunderbird Custom IdP (OIDC/OAuth2) — **OAuthPatch**

Adds a configurable **OAuth2/OIDC Identity Provider** for **IMAP/SMTP** in Thunderbird **without patching core**.

**Thunderbird 140+ only** (uses internal `OAuth2Providers.registerProvider/unregisterProvider` APIs).

Configuration can be sourced from:
- a remote **HTTPS URL** (stored in `storage.local.configUrl`), or
- a packaged `config.json` at the add-on root,
- or loaded **manually** from profile via Options (**Load from profile**).

Changes are applied hot (no Thunderbird restart required).

> Internal Thunderbird APIs may change in future versions. If something breaks after a TB update, please open an issue with logs.

---

## TL;DR (Quick Start)

1. Install the add-on (see **Installation**).
2. Open **Add-on Options** → set configuration using one of these:
- Paste an **HTTPS URL** or inline JSON into the top field → click **Apply**; or
- Click **Browse…** → pick a local JSON → click **Apply**; or
- Paste JSON into the large textarea → **Apply pasted JSON**; or
- **Load from profile (oauthpatch.json)** (TB 140+).
3. Choose where to store `clientSecret`: `prefs` / `Login Manager` / `memory`.
4. In Account Settings set **Authentication method → OAuth2** (for both IMAP and SMTP), then sign in.

---

## What the add-on does

- Stores config in Thunderbird prefs under `extensions.oauthpatch.*`.
- On `init()` it registers a provider via:
  - `OAuth2Providers.registerProvider(...)` with:
    - issuer + endpoints + redirect URI
    - clientId/clientSecret (optional)
    - PKCE flag
    - **one or many hostnames**
    - a merged scopes string
- On re-init it tries to unregister the previously registered issuer (stored in `extensions.oauthpatch._registeredIssuer`).
- On add-on disable/update (non-app shutdown) it attempts to unregister the last issuer to avoid leaving stale entries behind.

---

## Data flow

```
Options (URL / file / inline JSON / profile)
  → browser.oauthpatch.applyConfig()
    → prefs: extensions.oauthpatch.*
      → browser.oauthpatch.init()
        → OAuth2Providers.registerProvider(...)
          → Thunderbird OAuth2 flow (IMAP/SMTP)
```

---

## Configuration sources (precedence)

**Automatic at startup:**
1) `storage.local.configUrl` (set when you Apply an HTTPS URL in Options)
2) Packaged `config.json` (add-on root)

**Manual (on click in Options):**
- **Load from profile** reads `oauthpatch.json` from your Thunderbird profile directory and applies it once.

> Note: there is no manifest default URL fallback in v3.x.

---

## Remote loading constraints

Remote config fetch (background):
- **HTTPS only**
- Timeout: **15 seconds**
- Response size limit: **~256 KiB**
- Fetched with `cache: no-store`

Local file via Options:
- Size limit: **128 KiB** (UI restriction)

Basic auth is supported via URL form:
`https://user:pass@example.com/secure/oauthpatch.json`

---

## `config.json` format

Minimal example (Keycloak-like IdP):

```json
{
  "hostname": "imap.example.com smtp.example.com",
  "issuer": "auth.example.com",
  "clientId": "thunderbird",
  "clientSecret": "CHANGE_ME",
  "usePkce": true,
  "authorizationEndpoint": "https://auth.example.com/realms/main/protocol/openid-connect/auth",
  "tokenEndpoint": "https://auth.example.com/realms/main/protocol/openid-connect/token",
  "redirectUri": "https://localhost",
  "scopes": {
    "imap": "openid email profile",
    "smtp": "openid email profile"
  }
}
```

### Fields

- **hostname** — IMAP/SMTP host(s) that should use this issuer.
  - Can contain **multiple hostnames** separated by spaces and/or commas:
    - `"imap.example.com,smtp.example.com"`
    - `"imap.example.com smtp.example.com"`
  - Matching is case-insensitive (normalized to lower-case).
- **issuer** — IdP issuer (host / domain). Case-insensitive.
- **clientId** — OAuth2 client id.
- **clientSecret** — optional. For public clients keep empty and set `usePkce: true`.
- **usePkce** — boolean.
- **authorizationEndpoint** — OIDC authorization endpoint URL.
- **tokenEndpoint** — token endpoint URL.
- **redirectUri** — redirection endpoint used by Thunderbird (commonly `https://localhost`).
- **scopes.imap / scopes.smtp** — scopes by protocol.
  - The add-on registers **a merged scopes union** of both strings.
  - If you only set `scopes.imap`, you can set smtp same or leave it empty (it will still be merged).

---

## Where it is stored in Thunderbird

Preferences under `extensions.oauthpatch.*`:

```
hostname
issuer
clientId
clientSecret (only if mode = prefs)
usePkce
authorizationEndpoint
tokenEndpoint
redirectUri
scopes.imap
scopes.smtp

_registeredIssuer   (internal bookkeeping for unregister on re-init)
```

---

## Secret storage modes

Choose in Options → **Secret storage**:

- **prefs** (default) — stored as plain pref `extensions.oauthpatch.clientSecret` (**not encrypted**).
- **Login Manager** — saved into Thunderbird Login Manager:
  - origin: `oauth://<issuer>`
  - realm: `oauthpatch:client-secret`
  - username: `<clientId>`
  - password: `<clientSecret>`
  - With **Primary Password** enabled, TB may prompt once per session.
- **memory** — stored only in memory (session-only), cleared on TB restart.

Tip (debug): you can trigger a read and thus prompt Primary Password:
```js
await browser.oauthpatch.unlockSecret();
```

---

## Installation

### Temporary load (development)

1. Thunderbird → **Tools → Add-ons and Themes → Gear icon → Debug Add-ons**
2. Click **Load Temporary Add-on** and pick `manifest.json`

### Pack to XPI

1. Zip the add-on folder contents (the files next to `manifest.json`)
2. Rename to `oauthpatch.xpi`
3. Install via **Add-ons and Themes → Install Add-on From File…**

> Local installations typically do not require signing; enterprise builds may enforce policies.

---

## Options UI

Top **Config** field supports:
- `https://...` URL (optionally with `user:pass@`)
- inline JSON (`{...}`)
- local file via **Browse…** (then `file:<name>` placeholder appears)

Buttons that are functional in the current code path:
- **Apply** (top row) — applies file / inline JSON / URL (URL is also saved to `storage.local.configUrl`)
- **Apply pasted JSON**
- **Load from profile (oauthpatch.json)** (TB 140+)
- **Reset secret**

Status / errors are shown below.

---

## Verify it works

1. In **Account Settings**, set **Authentication method → OAuth2** for both IMAP and SMTP.
2. Connect: your IdP login page should appear.
3. After successful login, Thunderbird completes OAuth2 and stores tokens as usual.
4. Open **Tools → Developer Tools → Error Console** and search for `"[OAuthPatch]"`.

---

## Logging & diagnostics

Logs use `console.log/warn/error` with the `[OAuthPatch]` prefix.

Typical messages:
- `background loaded`
- `Remote config applied from: <origin>`
- `Packaged config.json applied`
- `provider registered via registerProvider: <issuer> [hostnames...]`
- `unregistered previous provider: <issuer>`
- `init failed: ...`

If something fails after a Thunderbird update, include:
- Thunderbird version (must be **140+**)
- the Error Console output around `[OAuthPatch]`
- whether you used URL/file/pasted JSON/profile

---

## Design notes & limitations

- Requires **Thunderbird 140+**.
- Uses internal `OAuth2Providers` APIs; they may change between Thunderbird versions.
- Registers **one issuer/provider at a time**, but supports **multiple hostnames** for that provider.
- `prefs` secret storage is not secure; prefer **Login Manager** or **memory**.

---

## Programmatic API (debugging)

Available in the add-on context:

```js
await browser.oauthpatch.applyConfig({...}, { force: true, storeSecret: "login" });
await browser.oauthpatch.init();
await browser.oauthpatch.resetSecret();
await browser.oauthpatch.unlockSecret();
await browser.oauthpatch.loadAndApplyFromProfile("oauthpatch.json", { force: true, storeSecret: "prefs" });
```

---

## License

MIT (see `LICENSE`).
