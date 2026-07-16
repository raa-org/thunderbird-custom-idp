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
4. Continue in **Account Hub** and sign in on your IdP authorization page.

For an existing account, open **Account Settings** and make sure **Authentication method** is set to **OAuth2** for both IMAP and SMTP.

---

## Account Hub setup

After the add-on has been installed and your OAuth2/OIDC provider config has been applied successfully, return to Thunderbird Account Hub.

1. Enter the account name and email address, then click **Continue**.

![Account Hub: enter name and email](docs/screenshots/account-hub-01-start.png)

2. Account Hub should pick up the IMAP/SMTP settings for the configured hostname. Review the detected settings, then continue.

![Account Hub: detected provider settings](docs/screenshots/account-hub-02-start.png)

3. On the next step, Thunderbird should open your IdP authorization page. Complete the login there, then Thunderbird will finish adding the account with OAuth2 authentication.

---

## What the add-on does

- Stores config in Thunderbird prefs under `extensions.oauthpatch.*`.
- On `init()` it registers every configured provider via:
  - `OAuth2Providers.registerProvider(...)` with:
    - issuer + endpoints + redirect URI
    - clientId/clientSecret (optional)
    - PKCE flag
    - **one or many hostnames**
    - a merged scopes string
- On re-init it unregisters the previously registered issuers (stored in `extensions.oauthpatch._registeredIssuers`).
- On add-on disable/update (non-app shutdown) it attempts to unregister all managed issuers to avoid leaving stale entries behind.

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
3) Existing saved provider config in Thunderbird prefs

**Manual (on click in Options):**
- **Load from profile** reads `oauthpatch.json` from your Thunderbird profile directory and applies it once.
- Applying inline JSON, a local file, or a profile config clears the saved HTTPS URL so it will not overwrite that manual config on the next startup.

> Note: there is no manifest default URL fallback in the current version.

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

Multiple providers can be configured with a `providers` array:

```json
{
  "disableExchangeAutodiscovery": true,
  "providers": [
    {
      "name": "production",
      "hostname": "imap.example.com smtp.example.com",
      "issuer": "auth.example.com",
      "clientId": "thunderbird",
      "usePkce": true,
      "authorizationEndpoint": "https://auth.example.com/authorize",
      "tokenEndpoint": "https://auth.example.com/token",
      "redirectUri": "https://localhost",
      "scopes": { "imap": "openid email profile", "smtp": "openid email profile" }
    },
    {
      "name": "testing",
      "hostname": "imap.test.example.com smtp.test.example.com",
      "issuer": "auth.test.example.com",
      "clientId": "thunderbird-test",
      "usePkce": true,
      "authorizationEndpoint": "https://auth.test.example.com/authorize",
      "tokenEndpoint": "https://auth.test.example.com/token",
      "redirectUri": "https://localhost",
      "scopes": { "imap": "openid email profile", "smtp": "openid email profile" }
    }
  ]
}
```

Issuers and hostnames must be unique across providers. The original single-provider format remains supported.

To replace a built-in Thunderbird mapping (for example Microsoft 365), opt in per provider:

```json
{
  "providers": [
    {
      "hostname": "outlook.office365.com smtp.office365.com",
      "issuer": "auth.example.com",
      "clientId": "thunderbird",
      "usePkce": true,
      "overrideBuiltIn": true,
      "authorizationEndpoint": "https://auth.example.com/authorize",
      "tokenEndpoint": "https://auth.example.com/token",
      "redirectUri": "https://localhost",
      "scopes": { "imap": "openid email", "smtp": "openid email" }
    }
  ]
}
```

Overrides use exact hostname matching and are removed when the add-on is disabled. The OAuth tokens returned by the custom provider must still be accepted by the target IMAP/SMTP servers.

Exchange Autodiscovery is disabled by default so Account Hub uses the standard IMAP/SMTP autoconfig without opening a parallel Microsoft Exchange login. Set root-level `disableExchangeAutodiscovery` to `false` to opt out. The add-on restores the previous Thunderbird preference when this option is disabled or the add-on is unloaded.

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
- **overrideBuiltIn** — explicitly replace Thunderbird's built-in OAuth mapping for the listed exact hostnames.
- **disableExchangeAutodiscovery** — root-level boolean, default `true`; set to `false` to allow Account Hub's parallel Exchange discovery.
- **authorizationEndpoint** — OIDC authorization endpoint URL.
- **tokenEndpoint** — token endpoint URL.
- **redirectUri** — redirection endpoint used by Thunderbird (commonly `https://localhost`).
- **scopes.imap / scopes.smtp** — scopes by protocol.
  - The add-on registers **a merged scopes union** of both strings.
  - If you only set `scopes.imap`, you can set smtp same or leave it empty (it will still be merged).

---

## Where it is stored in Thunderbird

Provider configuration is stored as JSON under:

```
providers             (provider array; includes clientSecret on each provider only in prefs mode)
secretMode
_registeredIssuers    (internal bookkeeping for unregister on re-init)
disableExchangeAutodiscovery
_exchangeAutodiscoveryOverrideActive
_exchangeAutodiscoveryOriginalHadUserValue
_exchangeAutodiscoveryOriginalValue
```

Existing flat preferences are read as a legacy single-provider configuration.
The `_exchangeAutodiscovery...` values are internal bookkeeping used to restore Thunderbird's previous Exchange Autodiscovery preference.

---

## Secret storage modes

Choose in Options → **Secret storage**:

- **prefs** (default) — stored unencrypted inside the JSON pref
  `extensions.oauthpatch.providers` as `clientSecret` on each provider.
  Legacy flat configs may use `extensions.oauthpatch.clientSecret`.
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

### Pack with 7-Zip

Install 7-Zip and make sure `7z.exe` is available in `PATH`, or installed in
`C:\Program Files\7-Zip\7z.exe`.

Run from the repository root:

```bat
scripts\build-xpi.cmd
```

PowerShell equivalent:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-xpi.ps1
```

If 7-Zip is installed elsewhere, pass the path explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-xpi.ps1 -SevenZipPath "C:\Tools\7-Zip\7z.exe"
```

The script reads the version from `src/manifest.json` and creates:

```text
dist\thunderbird-custom-idp-v<version>.xpi
```

---

## Options UI

Top **Config** field supports:
- `https://...` URL (optionally with `user:pass@`)
- inline JSON (`{...}`)
- local file via **Browse…** (then `file:<name>` placeholder appears)

Buttons that are functional in the current code path:
- **Apply** (top row) — applies file / inline JSON / URL. HTTPS URLs are saved to `storage.local.configUrl`; file and inline JSON configs clear that saved URL.
- **Apply pasted JSON**
- **Load from profile (oauthpatch.json)** (TB 140+; clears the saved URL)
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
- Registers multiple issuers/providers at once; each provider can use multiple hostnames.
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
