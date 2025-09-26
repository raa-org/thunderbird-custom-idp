this.oauthpatch = class extends ExtensionCommon.ExtensionAPI {
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

        const LOG_ONCE = new Set();
        function logOnce(key, ...args) {
            if (LOG_ONCE.has(key)) return;
            LOG_ONCE.add(key);
            console.log(...args);
        }
        const CACHE_HOST = new Map();
        const CACHE_ISS  = new Map();
        function cfgSignature(cfg) {
            return [
                cfg.HOSTNAME, cfg.ISSUER, cfg.CLIENT_ID,
                cfg.AUTH_ENDPOINT, cfg.TOKEN_ENDPOINT, cfg.REDIRECT_URI,
                String(!!cfg.USE_PKCE),
                cfg.SCOPES?.imap || "", cfg.SCOPES?.smtp || ""
            ].join("|");
        }
        function sanitizeHost(v) { return String(v || "").trim().toLowerCase(); }

        const Cc = Components.classes, Ci = Components.interfaces;
        const prefSvc = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
        const root = prefSvc.getBranch("");

        function getStringPref(name, def = "") {
            try { return root.getStringPref(name); } catch {
                try { return root.getCharPref(name); } catch { return def; }
            }
        }
        function setStringPref(name, val) { try { root.setStringPref(name, String(val)); } catch { root.setCharPref(name, String(val)); } }
        function getBoolPref(name, def = false) { try { return root.getBoolPref(name); } catch { return def; } }
        function setBoolPref(name, val) { root.setBoolPref(name, !!val); }
        function setIntPref(name, val)  { root.setIntPref(name, val | 0); }
        function getPrefType(name)      { return root.getPrefType(name); }

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
            if (typeof lm.storeLogin === "function") return lm.storeLogin(loginInfo); // very old fallback
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
                try {
                    return lm.searchLogins({},
                        { origin: hostname, httpRealm }) || [];
                } catch { return []; }
            }
            return [];
        }

        function saveSecretToLogins({ clientId, issuer, secret }) {
            const hostname  = `oauth://${issuer}`;
            const httpRealm = "oauthpatch:client-secret";
            const existing = findLoginsCompat(hostname, httpRealm);
            for (const l of existing) {
                if (l.username === clientId) {
                    void removeLoginCompat(l);
                }
            }
            if (secret && String(secret).trim()) {
                const info = newLoginInfo({ hostname, httpRealm, username: clientId, password: String(secret) });
                return addLoginCompat(info).then(() => {
                    console.log("[OAuthPatch] secret saved to Login Manager");
                }).catch(e => {
                    console.warn("[OAuthPatch] saveSecretToLogins failed:", e);
                });
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
            for (const l of list) {
                if (l.username === clientId) {
                    void removeLoginCompat(l);
                }
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
            const os = importAny(["resource://gre/modules/osfile.jsm"]);
            if (os && os.OS) {
                const { OS } = os;
                const path = OS.Path.join(OS.Constants.Path.profileDir, filename);
                const arr  = await OS.File.read(path);
                const text = new TextDecoder().decode(arr);
                return JSON.parse(text);
            }
            throw new Error("No IO modules available");
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
                const issuer   = obj.issuer   || getStr("issuer");
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
                    // async-compatible save
                    saveSecretToLogins({ clientId, issuer, secret: val || null });
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    VOLATILE.clientSecret = null;
                    console.log("[OAuthPatch] clientSecret stored in Login Manager");
                }
            }
        }

        function buildConfigFromPrefs() {
            const HOSTNAME  = sanitizeHost(getStr("hostname"));
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
                HOSTNAME, ISSUER,
                CLIENT_ID, CLIENT_SECRET, USE_PKCE,
                AUTH_ENDPOINT, TOKEN_ENDPOINT, REDIRECT_URI,
                SCOPES: { imap: SCOPES_IMAP, smtp: SCOPES_SMTP },
            };
        }

        let patched = false;

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
                    const issuer   = getStr("issuer");
                    VOLATILE.clientSecret = null;
                    try { root.clearUserPref(PREF_BRANCH + "clientSecret"); } catch {}
                    try { removeSecretFromLogins({ clientId, issuer }); } catch {}
                    console.log("[OAuthPatch] secret removed (prefs + Login Manager)");
                    return true;
                },

                unlockSecret() {
                    try {
                        const clientId = getStr("clientId");
                        const issuer   = getStr("issuer");
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
                        if (patched) { console.log("[OAuthPatch] already patched, skip"); return; }
                        console.log("[OAuthPatch] init() called, attempting injection");

                        const mod = importAny([
                            "resource:///modules/OAuth2Providers.sys.mjs",
                            "resource:///modules/OAuth2Providers.jsm"
                        ]);
                        if (!mod || !mod.OAuth2Providers) throw new Error("OAuth2Providers module not available");
                        const { OAuth2Providers } = mod;

                        {
                            const cfg0 = buildConfigFromPrefs();
                            const ready =
                                !!cfg0.HOSTNAME && !!cfg0.ISSUER &&
                                !!cfg0.AUTH_ENDPOINT && !!cfg0.TOKEN_ENDPOINT &&
                                !!cfg0.REDIRECT_URI && !!cfg0.CLIENT_ID;
                            if (!ready) {
                                console.warn("[OAuthPatch] init skipped: config not present yet");
                                return;
                            }
                        }

                        const origGetHostnameDetails = OAuth2Providers.getHostnameDetails.bind(OAuth2Providers);
                        const origGetIssuerDetails   = OAuth2Providers.getIssuerDetails.bind(OAuth2Providers);

                        OAuth2Providers.getHostnameDetails = (hostname, type) => {
                            try {
                                const t = (type === "imap" || type === "smtp") ? type : "imap";
                                const hReq = sanitizeHost(hostname);
                                const cfg  = buildConfigFromPrefs();

                                const ready =
                                    !!cfg.HOSTNAME && !!cfg.ISSUER &&
                                    !!cfg.AUTH_ENDPOINT && !!cfg.TOKEN_ENDPOINT &&
                                    !!cfg.REDIRECT_URI && !!cfg.CLIENT_ID;
                                if (!ready) {
                                    try { return origGetHostnameDetails(hostname, t); } catch { return null; }
                                }

                                const hCfg = sanitizeHost(cfg.HOSTNAME);
                                if (hReq === hCfg) {
                                    const sig = cfgSignature(cfg);
                                    const key = `${sig}|${hReq}|${t}`;
                                    const cached = CACHE_HOST.get(key);
                                    if (cached) return cached;

                                    const scopes = (cfg.SCOPES && (cfg.SCOPES[t] || cfg.SCOPES.imap)) || "";
                                    const res = {
                                        issuer: cfg.ISSUER,
                                        allScopes: [cfg.SCOPES?.imap || "", cfg.SCOPES?.smtp || ""].join(" ").trim(),
                                        requiredScopes: scopes,
                                    };
                                    CACHE_HOST.set(key, res);
                                    logOnce(`host:${key}`, "[OAuthPatch] Injected hostname for:", hostname, t);
                                    return res;
                                }

                                try {
                                    return origGetHostnameDetails(hostname, t);
                                } catch {
                                    try { return origGetHostnameDetails(hostname, "smtp"); } catch { return null; }
                                }
                            } catch (e) {
                                console.warn("[OAuthPatch] getHostnameDetails wrapper error, falling back:", e);
                                try { return origGetHostnameDetails(hostname, "imap"); } catch { return null; }
                            }
                        };

                        OAuth2Providers.getIssuerDetails = (issuer, type) => {
                            try {
                                const cfg = buildConfigFromPrefs();
                                const ready =
                                    !!cfg.HOSTNAME && !!cfg.ISSUER &&
                                    !!cfg.AUTH_ENDPOINT && !!cfg.TOKEN_ENDPOINT &&
                                    !!cfg.REDIRECT_URI && !!cfg.CLIENT_ID;
                                if (!ready) return origGetIssuerDetails(issuer, type);

                                const issReq = sanitizeHost(issuer);
                                const issCfg = sanitizeHost(cfg.ISSUER);
                                if (issReq === issCfg) {
                                    const sig = cfgSignature(cfg);
                                    const key = `${sig}|${issReq}`;
                                    const cached = CACHE_ISS.get(key);
                                    if (cached) return cached;

                                    const secret = cfg.CLIENT_SECRET && String(cfg.CLIENT_SECRET).trim().length ? cfg.CLIENT_SECRET : null;
                                    const res = {
                                        name: cfg.ISSUER,
                                        clientId: cfg.CLIENT_ID,
                                        clientSecret: secret,
                                        authorizationEndpoint: cfg.AUTH_ENDPOINT,
                                        tokenEndpoint:         cfg.TOKEN_ENDPOINT,
                                        redirectionEndpoint:   cfg.REDIRECT_URI,
                                        usePKCE:               cfg.USE_PKCE,
                                    };
                                    CACHE_ISS.set(key, res);
                                    logOnce(`issuer:${key}`, "[OAuthPatch] Injected issuer for:", issuer);
                                    return res;
                                }
                            } catch (e) {
                                console.warn("[OAuthPatch] getIssuerDetails wrapper error, falling back:", e);
                            }
                            return origGetIssuerDetails(issuer, type);
                        };

                        patched = true;
                        console.log("[OAuthPatch] Custom OAuth2 provider injected successfully");
                    } catch (e) {
                        console.error("[OAuthPatch] Injection failed:", e);
                    }
                },
            },
        };
    }
};
