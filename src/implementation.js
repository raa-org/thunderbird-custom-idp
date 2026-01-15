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
            const issuer = (root.getStringPref(PREF_BRANCH + "_registeredIssuer", "") || "")
                .trim()
                .toLowerCase();

            if (issuer) {
                try { OAuth2Providers.unregisterProvider(issuer); } catch {}
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

        // --- secret storage ---
        const VOLATILE = { clientSecret: null };

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

        function saveSecretToLogins({ clientId, issuer, secret }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const existing = findLoginsCompat(hostname, httpRealm);
            for (const l of existing) if (l.username === clientId) void removeLoginCompat(l);

            if (secret && String(secret).trim()) {
                const info = newLoginInfo({ hostname, httpRealm, username: clientId, password: String(secret) });
                return addLoginCompat(info)
                    .then(() => console.log("[OAuthPatch] secret saved to Login Manager"))
                    .catch(e => console.warn("[OAuthPatch] saveSecretToLogins failed:", e));
            }
        }

        function loadSecretFromLogins({ clientId, issuer }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const hit = findLoginsCompat(hostname, httpRealm).find(l => l.username === clientId);
            return hit ? hit.password : null;
        }

        function removeSecretFromLogins({ clientId, issuer }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const list = findLoginsCompat(hostname, httpRealm);
            for (const l of list) if (l.username === clientId) void removeLoginCompat(l);
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

        function validateConfig(obj) {
            if (!obj || typeof obj !== "object") throw new Error("Config must be an object");
            const requireStr = (k) => {
                if (!obj[k] || typeof obj[k] !== "string" || !obj[k].trim()) throw new Error(`Missing/invalid "${k}"`);
            };
            requireStr("hostname");
            requireStr("issuer");
            requireStr("clientId");
            requireStr("authorizationEndpoint");
            requireStr("tokenEndpoint");
            requireStr("redirectUri");
            if (obj.scopes && typeof obj.scopes === "object") {
                if (obj.scopes.imap && typeof obj.scopes.imap !== "string") throw new Error("scopes.imap must be string");
                if (obj.scopes.smtp && typeof obj.scopes.smtp !== "string") throw new Error("scopes.smtp must be string");
            }
            if ("usePkce" in obj && typeof obj.usePkce !== "boolean") throw new Error("usePkce must be boolean");
            return true;
        }

        function applyConfigObject(obj, { force = false, storeSecret } = {}) {
            validateConfig(obj);

            const mode = storeSecret || "prefs";

            for (const [k, v] of Object.entries(obj)) {
                if (k === "clientSecret") continue;
                if (k === "scopes" && v && typeof v === "object") {
                    if ("imap" in v) setPref("scopes.imap", v.imap, { force });
                    if ("smtp" in v) setPref("scopes.smtp", v.smtp, { force });
                } else if (k === "usePkce") {
                    setPref("usePkce", !!v, { force });
                } else {
                    setPref(k, v, { force });
                }
            }

            if ("clientSecret" in obj) {
                const clientId = obj.clientId || getStr("clientId");
                const issuer   = sanitizeHost(obj.issuer || getStr("issuer"));
                const val      = obj.clientSecret && String(obj.clientSecret).trim() ? String(obj.clientSecret) : "";

                if (mode === "prefs") {
                    setPref("clientSecret", val, { force: true });
                    VOLATILE.clientSecret = null;
                    try { removeSecretFromLogins({ clientId, issuer }); } catch {}
                    console.log("[OAuthPatch] clientSecret stored in prefs");
                } else if (mode === "memory") {
                    VOLATILE.clientSecret = val || null;
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    console.log("[OAuthPatch] clientSecret stored in memory");
                } else if (mode === "login") {
                    saveSecretToLogins({ clientId, issuer, secret: val || null });
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    VOLATILE.clientSecret = null;
                    console.log("[OAuthPatch] clientSecret stored in Login Manager");
                }
            }
        }

        function buildConfigFromPrefs() {
            const HOSTNAME  = getStr("hostname");
            const ISSUER    = sanitizeHost(getStr("issuer"));
            const CLIENT_ID = getStr("clientId");

            let CLIENT_SECRET = getStr("clientSecret", "");
            if (!CLIENT_SECRET || !CLIENT_SECRET.trim()) {
                CLIENT_SECRET = VOLATILE.clientSecret || loadSecretFromLogins({ clientId: CLIENT_ID, issuer: ISSUER }) || null;
            }

            const USE_PKCE       = getBool("usePkce");
            const AUTH_ENDPOINT  = getStr("authorizationEndpoint");
            const TOKEN_ENDPOINT = getStr("tokenEndpoint");
            const REDIRECT_URI   = getStr("redirectUri");
            const SCOPES_IMAP    = getStr("scopes.imap");
            const SCOPES_SMTP    = getStr("scopes.smtp");

            return {
                HOSTNAME,
                ISSUER,
                CLIENT_ID,
                CLIENT_SECRET,
                USE_PKCE,
                AUTH_ENDPOINT,
                TOKEN_ENDPOINT,
                REDIRECT_URI,
                SCOPES: { imap: SCOPES_IMAP, smtp: SCOPES_SMTP },
            };
        }

        function isReady(cfg) {
            return !!(
                cfg.HOSTNAME && cfg.ISSUER && cfg.CLIENT_ID &&
                cfg.AUTH_ENDPOINT && cfg.TOKEN_ENDPOINT && cfg.REDIRECT_URI
            );
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

        function patchHostnameDetailsTypeCompat(OAuth2Providers) {
            try {
                if (OAuth2Providers.__oauthpatchTypeCompatPatched) return;
                OAuth2Providers.__oauthpatchTypeCompatPatched = true;

                if (typeof OAuth2Providers.getHostnameDetails !== "function") return;

                const orig = OAuth2Providers.getHostnameDetails.bind(OAuth2Providers);
                OAuth2Providers.getHostnameDetails = (hostname, type) => {
                    const t = (type === "imap" || type === "smtp") ? type : "imap";
                    return orig(hostname, t);
                };

                console.log("[OAuthPatch] Patched getHostnameDetails(type) compat shim");
            } catch (e) {
                console.warn("[OAuthPatch] Failed to apply type compat shim:", e?.message || e);
            }
        }

        function initViaRegisterProvider(OAuth2Providers) {
            const cfg = buildConfigFromPrefs();
            if (!isReady(cfg)) {
                console.warn("[OAuthPatch] init skipped: config not present yet");
                return false;
            }

            const hostnames = parseHostnames(cfg.HOSTNAME);
            if (!hostnames.length) {
                console.warn("[OAuthPatch] init skipped: no hostnames");
                return false;
            }

            const scopes = mergeScopes(cfg.SCOPES?.imap, cfg.SCOPES?.smtp);

            const prevIssuer = sanitizeHost(getStr("_registeredIssuer", ""));
            if (prevIssuer) {
                try {
                    OAuth2Providers.unregisterProvider(prevIssuer);
                    console.log("[OAuthPatch] unregistered previous provider:", prevIssuer);
                } catch (e) {
                    console.warn("[OAuthPatch] unregisterProvider skipped:", e?.message || e);
                }
            }

            const secret = cfg.CLIENT_SECRET && String(cfg.CLIENT_SECRET).trim() ? String(cfg.CLIENT_SECRET) : null;

            try {
                OAuth2Providers.registerProvider(
                    cfg.ISSUER,
                    cfg.CLIENT_ID,
                    secret,
                    cfg.AUTH_ENDPOINT,
                    cfg.TOKEN_ENDPOINT,
                    cfg.REDIRECT_URI,
                    !!cfg.USE_PKCE,
                    hostnames,
                    scopes
                );

                setPref("_registeredIssuer", cfg.ISSUER, { force: true });
                console.log("[OAuthPatch] provider registered via registerProvider:", cfg.ISSUER, hostnames);
                return true;
            } catch (e) {
                console.error("[OAuthPatch] registerProvider failed:", e?.message || e);

                try { OAuth2Providers.unregisterProvider(cfg.ISSUER); } catch {}

                try {
                    OAuth2Providers.registerProvider(
                        cfg.ISSUER,
                        cfg.CLIENT_ID,
                        secret,
                        cfg.AUTH_ENDPOINT,
                        cfg.TOKEN_ENDPOINT,
                        cfg.REDIRECT_URI,
                        !!cfg.USE_PKCE,
                        hostnames,
                        scopes
                    );

                    setPref("_registeredIssuer", cfg.ISSUER, { force: true });
                    console.log("[OAuthPatch] provider registered after retry:", cfg.ISSUER);
                    return true;
                } catch (e2) {
                    console.error("[OAuthPatch] registerProvider retry failed:", e2?.message || e2);
                    return false;
                }
            }
        }

        return {
            oauthpatch: {
                async applyConfig(config, options) {
                    applyConfigObject(config, options || {});
                    console.log("[OAuthPatch] Config applied");
                    return true;
                },

                async loadAndApplyFromProfile(filename, options) {
                    const cfg = await readProfileJson(filename);
                    applyConfigObject(cfg, options || {});
                    console.log("[OAuthPatch] Profile config applied from", filename);
                    return true;
                },

                resetSecret() {
                    const clientId = getStr("clientId");
                    const issuer   = sanitizeHost(getStr("issuer"));
                    VOLATILE.clientSecret = null;
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    try { removeSecretFromLogins({ clientId, issuer }); } catch {}
                    console.log("[OAuthPatch] secret removed (prefs + Login Manager)");
                    return true;
                },

                unlockSecret() {
                    try {
                        const clientId = getStr("clientId");
                        const issuer   = sanitizeHost(getStr("issuer"));
                        void loadSecretFromLogins({ clientId, issuer });
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

                        patchHostnameDetailsTypeCompat(OAuth2Providers);
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
