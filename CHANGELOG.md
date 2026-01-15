# Changelog

All notable changes to this project will be documented in this file.

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
