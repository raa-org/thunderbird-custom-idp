# Changelog

All notable changes to this project will be documented in this file.

## [0.3.2] - 2026-08-19
### Fixed
- Mark asynchronous Experiment API methods as async in the schema so callers
  actually wait for configuration writes before registering OAuth providers.
- Fix the startup race that could leave a fresh Thunderbird profile offering
  password authentication until the provider was initialized manually.

## [0.3.1] - 2026-07-16
### Fixed
- Fix **Load from profile** on Thunderbird 140 ESR by resolving `oauthpatch.json` from the current profile directory and falling back to XPCOM file streams when `IOUtils` is unavailable in the add-on experiment context.

## [0.3.0] - 2026-07-16
### Added
- Support for registering multiple OAuth2/OIDC providers from a single `providers` array.
- Validation for duplicate issuers and hostnames across providers.
- Backward compatibility with the original single-provider configuration format and preferences.
- Optional `overrideBuiltIn` support for exact hostnames already handled by Thunderbird providers.
- Root-level `disableExchangeAutodiscovery` option with restoration of the previous Thunderbird preference on add-on shutdown.

### Fixed
- Keep explicit protocol types in OAuth hostname lookup so IMAP/SMTP scopes no longer trigger unnecessary CardDAV/CalDAV discovery.
- Make secret reset awaitable in the Options UI and re-register providers immediately without the removed secret.
- Clear the saved remote config URL when applying inline, local file, or profile configs so a stale URL does not overwrite the manual config on the next startup.
- Await Login Manager writes/removals when applying configs or resetting secrets.

## [0.2.0] - 2026-01-15
### Changed
- **Thunderbird 140+ required** (uses `OAuth2Providers.registerProvider/unregisterProvider`).
- Switched provider injection from runtime method overrides to official provider registration via `registerProvider`.
- Removed manifest default config URL fallback; startup config sources are now:
    - saved `storage.local.configUrl`, then
    - packaged `config.json`.

### Added
- Support for **multiple hostnames** in a single config (`hostname` can contain comma/space separated hosts).
- Automatic cleanup on add-on disable/update: unregister previously registered issuer (best-effort).
- Compatibility shim for callers that invoke `getHostnameDetails(hostname)` without the `type` argument.

### Fixed
- More robust re-apply logic: unregister previous issuer before registering a new one on re-init.

## [0.1.0] - 2025-09-26
- Initial public release.
