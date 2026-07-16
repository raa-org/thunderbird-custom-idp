this.oauthpatch = class extends ExtensionCommon.ExtensionAPI {
    onShutdown(isAppShutdown) {
        if (isAppShutdown) return;
        try {
            const mod = ChromeUtils.importESModule("resource:///modules/OAuth2Providers.sys.mjs");
            const { OAuth2Providers } = mod || {};
            if (!OAuth2Providers?.unregisterProvider) return;

            const Cc = Components.classes, Ci = Components.interfaces;
            const prefSvc = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
            const root = prefSvc.getBranch("");
            const PREF_BRANCH = "extensions.oauthpatch.";
            const EXCHANGE_AUTODISCOVERY_PREF = "mailnews.auto_config.fetchFromExchange.enabled";

            if (root.getBoolPref(PREF_BRANCH + "_exchangeAutodiscoveryOverrideActive", false)) {
                const hadUserValue = root.getBoolPref(
                    PREF_BRANCH + "_exchangeAutodiscoveryOriginalHadUserValue",
                    false
                );
                if (hadUserValue) {
                    root.setBoolPref(
                        EXCHANGE_AUTODISCOVERY_PREF,
                        root.getBoolPref(PREF_BRANCH + "_exchangeAutodiscoveryOriginalValue", true)
                    );
                } else {
                    try { root.clearUserPref(EXCHANGE_AUTODISCOVERY_PREF); } catch {}
                }
                try { root.clearUserPref(PREF_BRANCH + "_exchangeAutodiscoveryOverrideActive"); } catch {}
                try { root.clearUserPref(PREF_BRANCH + "_exchangeAutodiscoveryOriginalHadUserValue"); } catch {}
                try { root.clearUserPref(PREF_BRANCH + "_exchangeAutodiscoveryOriginalValue"); } catch {}
            }

            let issuers = [];
            try {
                issuers = JSON.parse(root.getStringPref(PREF_BRANCH + "_registeredIssuers", "[]"));
            } catch {}
            if (!Array.isArray(issuers)) issuers = [];

            // Migration cleanup for versions which tracked only one issuer.
            const legacyIssuer = (root.getStringPref(PREF_BRANCH + "_registeredIssuer", "") || "")
                .trim()
                .toLowerCase();
            if (legacyIssuer) issuers.push(legacyIssuer);

            for (const issuer of new Set(issuers)) {
                if (issuer) {
                    try { OAuth2Providers.unregisterProvider(issuer); } catch {}
                }
            }

            if (OAuth2Providers.__oauthpatchOriginalGetHostnameDetails) {
                OAuth2Providers.getHostnameDetails = OAuth2Providers.__oauthpatchOriginalGetHostnameDetails;
                delete OAuth2Providers.__oauthpatchOriginalGetHostnameDetails;
                delete OAuth2Providers.__oauthpatchHostnameOverrides;
            }
        } catch {}
    }

    getAPI(context) {
        function importAny(urls) {
            if (globalThis.ChromeUtils && "importESModule" in ChromeUtils) {
                for (const u of urls) if (u.endsWith(".sys.mjs")) {
                    try { return ChromeUtils.importESModule(u); } catch {}
                }
            }
            if (globalThis.ChromeUtils && typeof ChromeUtils.import === "function") {
                for (const u of urls) if (u.endsWith(".jsm")) {
                    try { return ChromeUtils.import(u); } catch {}
                }
            }
            return null;
        }

        function sanitizeHost(v) { return String(v || "").trim().toLowerCase(); }

        // --- prefs helpers ---
        const Cc = Components.classes, Ci = Components.interfaces;
        const prefSvc = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
        const root = prefSvc.getBranch("");

        function getStringPref(name, def = "") {
            try { return root.getStringPref(name); } catch {
                try { return root.getCharPref(name); } catch { return def; }
            }
        }
        function setStringPref(name, val) {
            try { root.setStringPref(name, String(val)); } catch { root.setCharPref(name, String(val)); }
        }
        function getBoolPref(name, def = false) { try { return root.getBoolPref(name); } catch { return def; } }
        function setBoolPref(name, val) { root.setBoolPref(name, !!val); }
        function setIntPref(name, val) { root.setIntPref(name, val | 0); }
        function getPrefType(name) { return root.getPrefType(name); }

        const PREF_BRANCH = "extensions.oauthpatch.";
        const EXCHANGE_AUTODISCOVERY_PREF = "mailnews.auto_config.fetchFromExchange.enabled";
        const hasPref = (k) => getPrefType(PREF_BRANCH + k) !== root.PREF_INVALID;
        const getStr  = (k, def = "")    => getStringPref(PREF_BRANCH + k, def);
        const getBool = (k, def = false) => getBoolPref(PREF_BRANCH + k, def);
        const setPref = (k, v, { force = false } = {}) => {
            const name = PREF_BRANCH + k;
            if (!force && hasPref(k)) return;
            if (typeof v === "boolean") setBoolPref(name, v);
            else if (Number.isInteger(v)) setIntPref(name, v);
            else setStringPref(name, String(v));
        };

        function restoreExchangeAutodiscoveryPreference() {
            if (!getBool("_exchangeAutodiscoveryOverrideActive", false)) return;
            const hadUserValue = getBool("_exchangeAutodiscoveryOriginalHadUserValue", false);
            if (hadUserValue) {
                setBoolPref(
                    EXCHANGE_AUTODISCOVERY_PREF,
                    getBool("_exchangeAutodiscoveryOriginalValue", true)
                );
            } else {
                try { root.clearUserPref(EXCHANGE_AUTODISCOVERY_PREF); } catch {}
            }
            for (const key of [
                "_exchangeAutodiscoveryOverrideActive",
                "_exchangeAutodiscoveryOriginalHadUserValue",
                "_exchangeAutodiscoveryOriginalValue",
            ]) {
                try { root.clearUserPref(PREF_BRANCH + key); } catch {}
            }
            console.log("[OAuthPatch] Exchange Autodiscovery preference restored");
        }

        function setExchangeAutodiscoveryDisabled(disabled) {
            if (!disabled) {
                restoreExchangeAutodiscoveryPreference();
                setPref("disableExchangeAutodiscovery", false, { force: true });
                return;
            }
            if (!getBool("_exchangeAutodiscoveryOverrideActive", false)) {
                let hadUserValue = false;
                try { hadUserValue = root.prefHasUserValue(EXCHANGE_AUTODISCOVERY_PREF); } catch {}
                setPref("_exchangeAutodiscoveryOriginalHadUserValue", hadUserValue, { force: true });
                setPref(
                    "_exchangeAutodiscoveryOriginalValue",
                    getBoolPref(EXCHANGE_AUTODISCOVERY_PREF, true),
                    { force: true }
                );
                setPref("_exchangeAutodiscoveryOverrideActive", true, { force: true });
            }
            setBoolPref(EXCHANGE_AUTODISCOVERY_PREF, false);
            setPref("disableExchangeAutodiscovery", true, { force: true });
            console.log("[OAuthPatch] Exchange Autodiscovery disabled");
        }

        // --- secret storage ---
        const VOLATILE_SECRETS = new Map();

        function providerKey({ issuer, clientId }) {
            return `${sanitizeHost(issuer)}\n${String(clientId || "")}`;
        }

        const ServicesMod = importAny(["resource://gre/modules/Services.sys.mjs"]);
        const Services = ServicesMod && ServicesMod.Services;

        function getLoginManager() {
            try { if (Services && Services.logins) return Services.logins; } catch {}
            try { return Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager); } catch {}
            return null;
        }

        function newLoginInfo({ hostname, httpRealm, username, password }) {
            const LoginInfo = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
            LoginInfo.init(hostname, null, httpRealm, username, password, "", "");
            return LoginInfo;
        }

        async function addLoginCompat(loginInfo) {
            const lm = getLoginManager();
            if (!lm) throw new Error("LoginManager unavailable");
            if (typeof lm.addLogin === "function") return lm.addLogin(loginInfo);
            if (typeof lm.addLoginAsync === "function") return lm.addLoginAsync(loginInfo);
            if (typeof lm.storeLogin === "function") return lm.storeLogin(loginInfo);
            throw new Error("No addLogin* method on LoginManager");
        }

        async function removeLoginCompat(loginInfo) {
            const lm = getLoginManager();
            if (!lm) return;
            if (typeof lm.removeLogin === "function") return lm.removeLogin(loginInfo);
            if (typeof lm.removeLoginAsync === "function") return lm.removeLoginAsync(loginInfo);
        }

        function findLoginsCompat(hostname, httpRealm) {
            const lm = getLoginManager();
            if (!lm) return [];
            if (typeof lm.findLogins === "function") {
                try { return lm.findLogins(hostname, null, httpRealm) || []; } catch { return []; }
            }
            if (typeof lm.searchLogins === "function") {
                try { return lm.searchLogins({}, { origin: hostname, httpRealm }) || []; } catch { return []; }
            }
            return [];
        }

        async function saveSecretToLogins({ clientId, issuer, secret }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const existing = findLoginsCompat(hostname, httpRealm);
            for (const l of existing) {
                if (l.username === clientId) await removeLoginCompat(l);
            }

            if (secret && String(secret).trim()) {
                const info = newLoginInfo({ hostname, httpRealm, username: clientId, password: String(secret) });
                try {
                    await addLoginCompat(info);
                    console.log("[OAuthPatch] secret saved to Login Manager");
                } catch (e) {
                    console.warn("[OAuthPatch] saveSecretToLogins failed:", e);
                    throw e;
                }
            }
        }

        function loadSecretFromLogins({ clientId, issuer }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const hit = findLoginsCompat(hostname, httpRealm).find(l => l.username === clientId);
            return hit ? hit.password : null;
        }

        async function removeSecretFromLogins({ clientId, issuer }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const list = findLoginsCompat(hostname, httpRealm);
            for (const l of list) {
                if (l.username === clientId) await removeLoginCompat(l);
            }
            console.log("[OAuthPatch] secret removed from Login Manager");
        }

        async function readProfileJson(filename) {
            const io = importAny(["resource://gre/modules/IOUtils.sys.mjs", "resource://gre/modules/PathUtils.sys.mjs"]);
            if (io && io.IOUtils && io.PathUtils) {
                const { IOUtils, PathUtils } = io;
                const path = PathUtils.join(PathUtils.profileDir, filename);
                const text = await IOUtils.readUTF8(path);
                return JSON.parse(text);
            }
            throw new Error("IOUtils/PathUtils not available (requires Thunderbird 140+)");
        }

        function validateProvider(obj, index = 0) {
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
                throw new Error(`Provider ${index + 1} must be an object`);
            }
            const requireStr = (k) => {
                if (!obj[k] || typeof obj[k] !== "string" || !obj[k].trim()) {
                    throw new Error(`Provider ${index + 1}: missing/invalid "${k}"`);
                }
            };
            requireStr("hostname");
            requireStr("issuer");
            requireStr("clientId");
            requireStr("authorizationEndpoint");
            requireStr("tokenEndpoint");
            requireStr("redirectUri");
            if ("scopes" in obj && (!obj.scopes || typeof obj.scopes !== "object" || Array.isArray(obj.scopes))) {
                throw new Error(`Provider ${index + 1}: scopes must be an object`);
            }
            if (obj.scopes) {
                if (obj.scopes.imap && typeof obj.scopes.imap !== "string") throw new Error("scopes.imap must be string");
                if (obj.scopes.smtp && typeof obj.scopes.smtp !== "string") throw new Error("scopes.smtp must be string");
            }
            if ("usePkce" in obj && typeof obj.usePkce !== "boolean") throw new Error("usePkce must be boolean");
            if ("overrideBuiltIn" in obj && typeof obj.overrideBuiltIn !== "boolean") {
                throw new Error("overrideBuiltIn must be boolean");
            }
            return true;
        }

        function normalizeProviders(config) {
            const providers = Array.isArray(config)
                ? config
                : (Array.isArray(config?.providers) ? config.providers : [config]);

            if (!providers.length) throw new Error("Config must contain at least one provider");

            const issuers = new Set();
            const hostnames = new Set();
            providers.forEach((provider, index) => {
                validateProvider(provider, index);
                const issuer = sanitizeHost(provider.issuer);
                if (issuers.has(issuer)) throw new Error(`Duplicate issuer: ${issuer}`);
                issuers.add(issuer);

                for (const hostname of parseHostnames(provider.hostname)) {
                    if (hostnames.has(hostname)) {
                        throw new Error(`Hostname assigned to multiple providers: ${hostname}`);
                    }
                    hostnames.add(hostname);
                }
            });
            return providers.map(provider => ({ ...provider, issuer: sanitizeHost(provider.issuer) }));
        }

        function readStoredProviders() {
            const serialized = getStr("providers", "");
            if (serialized) {
                try { return normalizeProviders(JSON.parse(serialized)); }
                catch (e) { throw new Error(`Invalid stored providers config: ${e.message}`); }
            }

            // Backward compatibility with the original flat preferences.
            const legacy = {
                hostname: getStr("hostname"),
                issuer: getStr("issuer"),
                clientId: getStr("clientId"),
                clientSecret: getStr("clientSecret", ""),
                usePkce: getBool("usePkce"),
                authorizationEndpoint: getStr("authorizationEndpoint"),
                tokenEndpoint: getStr("tokenEndpoint"),
                redirectUri: getStr("redirectUri"),
                scopes: { imap: getStr("scopes.imap"), smtp: getStr("scopes.smtp") },
            };
            return legacy.issuer ? normalizeProviders(legacy) : [];
        }

        async function applyConfigObject(config, { force = false, storeSecret = "prefs" } = {}) {
            // This add-on targets custom IMAP/SMTP OAuth. Exchange discovery runs in
            // parallel in Account Hub and can open Microsoft OAuth before the ISP
            // autoconfig wins, so disable it by default. Users can explicitly opt out.
            const disableExchangeAutodiscovery = Array.isArray(config) ||
                config?.disableExchangeAutodiscovery !== false;
            if (!Array.isArray(config) && "disableExchangeAutodiscovery" in (config || {}) &&
                typeof config.disableExchangeAutodiscovery !== "boolean") {
                throw new Error("disableExchangeAutodiscovery must be boolean");
            }
            const providers = normalizeProviders(config);
            if (!force && hasPref("providers")) return;
            const previous = new Map(readStoredProviders().map(p => [providerKey(p), p]));
            setExchangeAutodiscoveryDisabled(disableExchangeAutodiscovery);
            const stored = [];
            const nextKeys = new Set(providers.map(providerKey));

            for (const [key, provider] of previous) {
                if (!nextKeys.has(key)) {
                    VOLATILE_SECRETS.delete(key);
                    try { await removeSecretFromLogins(provider); } catch {}
                }
            }

            for (const provider of providers) {
                const key = providerKey(provider);
                const copy = { ...provider };
                delete copy.disableExchangeAutodiscovery;
                const hasSecret = Object.prototype.hasOwnProperty.call(provider, "clientSecret");
                const priorSecret = previous.get(key)?.clientSecret;
                const secret = String(hasSecret ? (provider.clientSecret || "") : (priorSecret || ""));

                if (storeSecret === "prefs") {
                    if (!hasSecret && priorSecret != null) {
                        copy.clientSecret = priorSecret;
                    }
                    VOLATILE_SECRETS.delete(key);
                    try { await removeSecretFromLogins(provider); } catch {}
                } else {
                    delete copy.clientSecret;
                    if ((hasSecret || priorSecret != null) && storeSecret === "memory") {
                        if (secret.trim()) VOLATILE_SECRETS.set(key, secret);
                        else VOLATILE_SECRETS.delete(key);
                        try { await removeSecretFromLogins(provider); } catch {}
                    } else if ((hasSecret || priorSecret != null) && storeSecret === "login") {
                        await saveSecretToLogins({ ...provider, secret: secret.trim() ? secret : null });
                        // Also bridge the asynchronous Login Manager write for this session.
                        if (secret.trim()) VOLATILE_SECRETS.set(key, secret);
                        else VOLATILE_SECRETS.delete(key);
                    }
                }
                stored.push(copy);
            }

            setPref("providers", JSON.stringify(stored), { force: true });
            setPref("secretMode", storeSecret, { force: true });
        }

        function resolveSecret(provider) {
            const prefSecret = String(provider.clientSecret || "").trim();
            return prefSecret || VOLATILE_SECRETS.get(providerKey(provider)) ||
                loadSecretFromLogins(provider) || null;
        }

        function parseHostnames(hostnameStr) {
            const raw = String(hostnameStr || "").trim();
            if (!raw) return [];
            return raw
                .split(/[,\s]+/g)
                .map(sanitizeHost)
                .filter(Boolean);
        }

        function mergeScopes(imap, smtp) {
            const parts = []
                .concat(String(imap || "").trim().split(/\s+/))
                .concat(String(smtp || "").trim().split(/\s+/))
                .map(s => s.trim())
                .filter(Boolean);
            return Array.from(new Set(parts)).join(" ");
        }

        function patchHostnameDetailsLookup(OAuth2Providers) {
            try {
                if (typeof OAuth2Providers.getHostnameDetails !== "function") return;
                if (OAuth2Providers.__oauthpatchOriginalGetHostnameDetails) return;

                const orig = OAuth2Providers.getHostnameDetails;
                OAuth2Providers.__oauthpatchOriginalGetHostnameDetails = orig;
                OAuth2Providers.__oauthpatchHostnameOverrides = new Map();
                OAuth2Providers.getHostnameDetails = (hostname, type) => {
                    // Some older callers omit the type. Preserve explicit protocol types
                    // so CardDAV/CalDAV do not accidentally inherit IMAP OAuth support.
                    const t = type || "imap";
                    const override = OAuth2Providers.__oauthpatchHostnameOverrides?.get(sanitizeHost(hostname));
                    if (override) {
                        const protocolScope = override.scopes?.[t];
                        const requiredScopes = String(
                            protocolScope || (["imap", "smtp"].includes(t) ? override.allScopes : "")
                        ).trim();
                        if (!requiredScopes) return undefined;
                        return {
                            issuer: override.issuer,
                            allScopes: override.allScopes,
                            requiredScopes,
                        };
                    }
                    return orig.call(OAuth2Providers, hostname, t);
                };

                console.log("[OAuthPatch] Patched getHostnameDetails lookup");
            } catch (e) {
                console.warn("[OAuthPatch] Failed to patch hostname lookup:", e?.message || e);
            }
        }

        function getRegisteredIssuers() {
            let issuers = [];
            try { issuers = JSON.parse(getStr("_registeredIssuers", "[]")); } catch {}
            if (!Array.isArray(issuers)) issuers = [];
            const legacyIssuer = sanitizeHost(getStr("_registeredIssuer", ""));
            if (legacyIssuer) issuers.push(legacyIssuer);
            return Array.from(new Set(issuers.map(sanitizeHost).filter(Boolean)));
        }

        function unregisterManagedProviders(OAuth2Providers) {
            for (const issuer of getRegisteredIssuers()) {
                try {
                    OAuth2Providers.unregisterProvider(issuer);
                    console.log("[OAuthPatch] unregistered previous provider:", issuer);
                } catch (e) {
                    console.warn("[OAuthPatch] unregisterProvider skipped:", e?.message || e);
                }
            }
            setPref("_registeredIssuers", "[]", { force: true });
            try { root.clearUserPref(PREF_BRANCH + "_registeredIssuer"); } catch {}
        }

        function registerProviderCompat(OAuth2Providers, provider, hostnames, scopes) {
            const secret = resolveSecret(provider);
            // Thunderbird 140 uses positional arguments. Newer versions use a details object.
            if (OAuth2Providers.registerProvider.length <= 3) {
                return OAuth2Providers.registerProvider({
                    name: provider.issuer,
                    clientId: provider.clientId,
                    clientSecret: secret,
                    authorizationEndpoint: provider.authorizationEndpoint,
                    tokenEndpoint: provider.tokenEndpoint,
                    redirectionEndpoint: provider.redirectUri,
                    usePKCE: !!provider.usePkce,
                }, hostnames, scopes);
            }
            return OAuth2Providers.registerProvider(
                provider.issuer,
                provider.clientId,
                secret,
                provider.authorizationEndpoint,
                provider.tokenEndpoint,
                provider.redirectUri,
                !!provider.usePkce,
                hostnames,
                scopes
            );
        }

        function initViaRegisterProvider(OAuth2Providers) {
            const providers = readStoredProviders();
            if (!providers.length) {
                console.warn("[OAuthPatch] init skipped: config not present yet");
                return false;
            }

            setExchangeAutodiscoveryDisabled(
                getBool("disableExchangeAutodiscovery", true)
            );

            // Validation happens in readStoredProviders before active providers are removed.
            unregisterManagedProviders(OAuth2Providers);
            const registered = [];
            const overrides = new Map();
            const originalLookup = OAuth2Providers.__oauthpatchOriginalGetHostnameDetails;

            try {
                for (const [index, provider] of providers.entries()) {
                    const configuredHostnames = parseHostnames(provider.hostname);
                    const scopes = mergeScopes(provider.scopes?.imap, provider.scopes?.smtp);
                    const hostnames = [];

                    for (const hostname of configuredHostnames) {
                        const existing = originalLookup?.call(OAuth2Providers, hostname, "imap") ||
                            originalLookup?.call(OAuth2Providers, hostname, "smtp");
                        overrides.set(hostname, {
                            issuer: provider.issuer,
                            scopes: provider.scopes || {},
                            allScopes: scopes,
                        });
                        if (!existing) {
                            hostnames.push(hostname);
                            continue;
                        }
                        if (!provider.overrideBuiltIn) {
                            throw new Error(
                                `Hostname ${hostname} is handled by built-in issuer ${existing.issuer}; ` +
                                "set overrideBuiltIn: true to override it"
                            );
                        }
                        console.log("[OAuthPatch] overriding built-in hostname:", hostname, "->", provider.issuer);
                    }

                    // registerProvider requires an issuer entry. Use an unreachable hostname when
                    // every real hostname is handled by the exact-match override above.
                    if (!hostnames.length) {
                        hostnames.push(`oauthpatch-${index}-${provider.issuer.replace(/[^a-z0-9.-]/g, "-")}.invalid`);
                    }

                    registerProviderCompat(OAuth2Providers, provider, hostnames, scopes);
                    registered.push(provider.issuer);
                    console.log("[OAuthPatch] provider registered via registerProvider:", provider.issuer, configuredHostnames);
                }

                OAuth2Providers.__oauthpatchHostnameOverrides = overrides;
                setPref("_registeredIssuers", JSON.stringify(registered), { force: true });
                return true;
            } catch (e) {
                console.error("[OAuthPatch] registerProvider failed:", e?.message || e);
                // Do not leave a partially applied provider set active.
                for (const issuer of registered) {
                    try { OAuth2Providers.unregisterProvider(issuer); } catch {}
                }
                OAuth2Providers.__oauthpatchHostnameOverrides = new Map();
                setPref("_registeredIssuers", "[]", { force: true });
                return false;
            }
        }

        return {
            oauthpatch: {
                async applyConfig(config, options) {
                    await applyConfigObject(config, options || {});
                    console.log("[OAuthPatch] Config applied");
                    return true;
                },

                async loadAndApplyFromProfile(filename, options) {
                    const cfg = await readProfileJson(filename);
                    await applyConfigObject(cfg, options || {});
                    console.log("[OAuthPatch] Profile config applied from", filename);
                    return true;
                },

                async resetSecret() {
                    const providers = readStoredProviders();
                    VOLATILE_SECRETS.clear();
                    for (const provider of providers) {
                        try { await removeSecretFromLogins(provider); } catch {}
                        delete provider.clientSecret;
                    }
                    if (hasPref("providers")) {
                        setPref("providers", JSON.stringify(providers), { force: true });
                    }
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    console.log("[OAuthPatch] secret removed (prefs + Login Manager)");
                    return true;
                },

                async unlockSecret() {
                    try {
                        for (const provider of readStoredProviders()) {
                            void loadSecretFromLogins(provider);
                        }
                        console.log("[OAuthPatch] unlockSecret called");
                        return true;
                    } catch (e) {
                        console.warn("[OAuthPatch] unlockSecret failed:", e);
                        return false;
                    }
                },

                init() {
                    try {
                        console.log("[OAuthPatch] init() called");

                        const mod = importAny(["resource:///modules/OAuth2Providers.sys.mjs"]);
                        if (!mod || !mod.OAuth2Providers) throw new Error("OAuth2Providers module not available");
                        const { OAuth2Providers } = mod;

                        if (typeof OAuth2Providers.registerProvider !== "function" ||
                            typeof OAuth2Providers.unregisterProvider !== "function") {
                            throw new Error("This add-on requires Thunderbird 140+ (registerProvider/unregisterProvider missing)");
                        }

                        patchHostnameDetailsLookup(OAuth2Providers);
                        const ok = initViaRegisterProvider(OAuth2Providers);
                        console.log("[OAuthPatch] init via registerProvider:", ok);
                    } catch (e) {
                        console.error("[OAuthPatch] init failed:", e);
                    }
                },
            },
        };
    }
};
