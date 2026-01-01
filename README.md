[![GitHub release (latest by date)](https://img.shields.io/github/v/release/raa-org/thunderbird-custom-idp)](https://github.com/raa-org/thunderbird-custom-idp/releases/latest)

# Thunderbird Custom IdP (OIDC/OAuth2) — **OAuthPatch** (add‑on)

Adds a configurable OAuth2/OIDC Identity Provider for IMAP/SMTP in Thunderbird **without patching core**. Configuration can be sourced from a remote HTTPS URL, from the add‑on manifest, or from a packaged `config.json`. Changes are applied hot, without restarting Thunderbird.

> Verified with Thunderbird 139+ . Internal APIs may change in future TB versions; if something breaks, please open an issue.

---

## TL;DR (Quick Start)
1. Install the add‑on (see **Installation** below).
2. Open the add‑on **Options** and choose a configuration source:
  - Paste an **HTTPS URL** to a JSON config and click **Test & Apply**; **or**
  - Bundle a `config.json` at the root of the add‑on; **or**
  - Click **Load from profile** to read `oauthpatch.json` from your Thunderbird profile directory.
3. Choose where to store `clientSecret`: `prefs` / `Login Manager` / `memory`.
4. In your mail account settings set **Authentication method → OAuth2** (for both IMAP and SMTP) and sign in.

---

## What the add‑on does
- Injects (via a WebExtension Experiment API) custom provider data into Thunderbird's `OAuth2Providers` module.
- Supplies values for **two extension points**:
  - `getHostnameDetails(hostname, type)` → per‑domain IMAP/SMTP mapping to an issuer and scopes;
  - `getIssuerDetails(issuer, type)` → issuer/client details and endpoints.
- Works **only** for the configured `hostname`/`issuer`; for everything else the original Thunderbird logic is used (fallback).
- Supports **hot reload**: changing the config URL in `storage.local` re‑applies the config and re‑initializes the patch automatically.

### Data flow
```
Options (URL/JSON/profile) → background.js → browser.oauthpatch.applyConfig()
→ write prefs at extensions.oauthpatch.* → oauthpatch.init()
→ override OAuth2Providers.getHostnameDetails / getIssuerDetails
→ Thunderbird OAuth2 flow (IMAP/SMTP)
```

---

## Configuration sources (precedence)
1. **`storage.local.configUrl`** — URL from Options (if set).
2. **`manifest.oauthpatch.configUrl`** — default URL from the add‑on manifest.
3. **Packaged `config.json`** — file at the add‑on root.
4. **Profile file** — **Load from profile** reads `oauthpatch.json` from your TB profile directory (applies once on click).

### Remote loading constraints
- **HTTPS only**.
- Timeout: **10 seconds**.
- Response size limit: **~128 KiB**.
- Always fetched with `cache: no-store` to avoid stale data.

---

## `config.json` format
Minimal example (Keycloak‑like IdP):
```json
{
  "hostname": "imap.example.com",
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
- **hostname** — IMAP/SMTP host that should use the custom issuer. Compared case‑insensitively (`toLowerCase()`).
- **issuer** — your IdP issuer host/domain. Compared case‑insensitively.
- **clientId** — OAuth2 client ID.
- **clientSecret** — **optional**. For public clients keep it empty and enable `usePkce: true`.
- **usePkce** — enables PKCE (recommended, especially for public clients).
- **authorizationEndpoint** — OIDC authorization endpoint URL.
- **tokenEndpoint** — token endpoint URL.
- **redirectUri** — redirect URI used by Thunderbird (often `https://localhost`).
- **scopes.imap / scopes.smtp** — protocol‑specific scopes; if only `imap` is set, SMTP falls back to it.

### Where it is stored in Thunderbird
Preferences under the `extensions.oauthpatch.*` branch:
```
hostname, issuer, clientId, clientSecret (if mode = prefs),
usePkce, authorizationEndpoint, tokenEndpoint, redirectUri,
scopes.imap, scopes.smtp
```

---

## Secret storage modes
Chosen in Options → **Secret storage**.

- **prefs** (default) — stored as a string preference (`extensions.oauthpatch.clientSecret`). *Not encrypted*; use for testing.
- **Login Manager** — saved to Thunderbird Login Manager under `oauth://<issuer>` (realm: `oauthpatch:client-secret`, username = `clientId`).
  - With **Primary Password** enabled, the OS dialog appears on first access per session.
  - Use **Reset secret** to remove it.
- **memory** — kept in process memory for the current session only; disappears after TB restart.

> Tip: you can trigger the Primary Password prompt programmatically from the add‑on console with `browser.oauthpatch.unlockSecret()`.

---

## Installation

Download the latest `.xpi` from Releases:
https://github.com/raa-org/thunderbird-custom-idp/releases/latest

1. Thunderbird → **Add-ons and Themes** → ⚙️ → **Install Add-on From File…**
2. Select the downloaded `.xpi`.
3. Open the add-on **Options**, set your config source, then click **Test & Apply**.

### Temporary load (development)
1. Thunderbird → **Tools → Add-ons and Themes → Gear icon → Debug Add-ons**.
2. Click **Load Temporary Add-on** and pick `manifest.json`.

### Pack to XPI
1. Zip the add-on folder contents (the files next to `manifest.json`).
2. Rename the archive to `thunderbird-custom-idp.xpi`.
3. Install via **Add-ons and Themes → Install Add-on From File…**.

> Local installations typically do **not** require signing; corporate builds may enforce different policies.

---

## Options (UI)
- **Remote config URL (HTTPS)** — saves the URL and applies config on the fly.
- **Secret storage** — `prefs` / `Login Manager` / `memory`.
- **Paste JSON config** — paste JSON and apply without URL or file.
- **Load from profile** — reads `oauthpatch.json` from the TB profile directory.
- **Reset secret** — removes the secret from prefs and Login Manager.

Status and errors are shown below the buttons.

---

## Verify it works
1. In **Account Settings**, pick **Authentication method → OAuth2** for both IMAP and SMTP.
2. Connect: your IdP login page should appear.
3. After successful login, Thunderbird completes the flow and stores refresh/access tokens as usual.
4. Open **Tools → Developer Tools → Error Console** and search for logs containing `"[OAuthPatch]"`.


## Logging & diagnostics
- Logs use `console.log/warn/error` with the `[OAuthPatch]` prefix.
- Typical messages:
  - `Remote config applied from: <url>` — remote config fetched and applied.
  - `Packaged config.json applied` — packaged config used.
  - `bootstrap deferred: no config source available yet` — no config source yet (e.g., URL not set).
  - `Injected hostname for: <host> <type>` / `Injected issuer for: <issuer>` — overrides are active.

---


## Design notes & limitations
- Single active provider at a time (one `hostname`/`issuer`). Multi‑provider configs are not supported out of the box.
- Overrides are targeted: only for the configured `hostname`/`issuer`. Everything else falls back to Thunderbird defaults.
- Storing secrets in `prefs` is **not** secure; prefer `Login Manager` or `memory` for production.
- Remote load limits: 10 s timeout, ~128 KiB, HTTPS only.

---

## Security
- With **Login Manager**, secrets are protected by TB/OS facilities (and Primary Password, if enabled).
- Remote config is fetched over **HTTPS** with a strict size/time budget.
- The add‑on **does not read mail data** by itself — `accountsRead`/`messagesRead` permissions are conservative and can be removed if not needed.

---

## Examples
### Public client (no secret, PKCE)
```json
{
  "hostname": "imap.example.com",
  "issuer": "auth.example.com",
  "clientId": "tb-public",
  "usePkce": true,
  "authorizationEndpoint": "https://auth.example.com/realms/main/protocol/openid-connect/auth",
  "tokenEndpoint": "https://auth.example.com/realms/main/protocol/openid-connect/token",
  "redirectUri": "https://localhost",
  "scopes": { "imap": "openid email", "smtp": "openid email" }
}
```

### Confidential client (secret in Login Manager)
1) In Options select **Login Manager**.
2) Apply the config:
```json
{
  "hostname": "imap.corp.local",
  "issuer": "sso.corp.local",
  "clientId": "thunderbird",
  "clientSecret": "<SECRET>",
  "usePkce": false,
  "authorizationEndpoint": "https://sso.corp.local/realms/main/protocol/openid-connect/auth",
  "tokenEndpoint": "https://sso.corp.local/realms/main/protocol/openid-connect/token",
  "redirectUri": "https://localhost",
  "scopes": { "imap": "openid email profile" }
}
```

---

## Programmatic API (debugging)
Available in the add‑on context:
```js
await browser.oauthpatch.applyConfig({...}, { force: true, storeSecret: "login" });
await browser.oauthpatch.init();
await browser.oauthpatch.resetSecret();
await browser.oauthpatch.unlockSecret();
await browser.oauthpatch.loadAndApplyFromProfile("oauthpatch.json", { force: true, storeSecret: "prefs" });
```

---

## Known issues / TODO
- [ ] Support multiple providers in a single config.
- [ ] UI control to call `unlockSecret()` (currently only via console).
- [ ] Reduce permissions to the bare minimum.

---

## License


