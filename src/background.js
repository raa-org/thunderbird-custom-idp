console.log("[OAuthPatch] background loaded");

function concatUint8(chunks, total) {
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    return buf;
}
function isHttpsUrl(u) {
    try { const x = new URL(u); return x.protocol === "https:"; } catch { return false; }
}

function resolveAuthFromUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        const hasAuth = !!u.username || !!u.password;
        const headers = { Accept: "application/json" };
        if (!hasAuth) return { url: u.toString(), headers };

        const user = decodeURIComponent(u.username || "");
        const pass = decodeURIComponent(u.password || "");
        u.username = ""; u.password = "";
        headers.Authorization = "Basic " + btoa(`${user}:${pass}`);
        return { url: u.toString(), headers };
    } catch {
        return { url: urlStr, headers: { Accept: "application/json" } };
    }
}

async function fetchJsonWithTimeout(url, ms = 15000, maxBytes = 256 * 1024) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const { url: cleanUrl, headers } = resolveAuthFromUrl(url);
        const resp = await fetch(cleanUrl, { cache: "no-store", signal: ctrl.signal, headers });
        if (!resp.ok) {
            let snippet = "";
            try { snippet = (await resp.text()).slice(0, 256); } catch {}
            throw new Error(`HTTP ${resp.status}${snippet ? `: ${snippet}` : ""}`);
        }
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > maxBytes) throw new Error("Config too large");
            chunks.push(value);
        }
        const text = new TextDecoder("utf-8").decode(concatUint8(chunks, received));
        return JSON.parse(text);
    } finally {
        clearTimeout(timer);
    }
}

async function tryLoadRemote(url, storeSecretMode) {
    try {
        if (!isHttpsUrl(url)) throw new Error("URL must be HTTPS");
        const json = await fetchJsonWithTimeout(url);
        await browser.oauthpatch.applyConfig(json, { force: true, storeSecret: storeSecretMode || "prefs" });
        console.log("[OAuthPatch] Remote config applied from:", (() => { try { return new URL(url).origin; } catch { return "[sanitized]"; } })());
        return true;
    } catch (e) {
        console.warn("[OAuthPatch] Remote config failed:", e?.message || e);
        return false;
    }
}

async function tryLoadPackaged() {
    try {
        const url = browser.runtime.getURL("config.json");
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        await browser.oauthpatch.applyConfig(json, { force: true, storeSecret: "prefs" });
        console.log("[OAuthPatch] Packaged config.json applied");
        return true;
    } catch (e) {
        console.warn("[OAuthPatch] No packaged config.json:", e?.message || e);
        return false;
    }
}

async function readStore(k) {
    try { return (await browser.storage.local.get(k))[k]; } catch { return undefined; }
}

async function bootstrap() {
    const manifest = browser.runtime.getManifest();
    const storedUrl = await readStore("configUrl");
    const storedMode = await readStore("storeSecret") || "prefs";
    const manifestUrl = manifest.oauthpatch && manifest.oauthpatch.configUrl;

    let applied = false;
    if (storedUrl) applied = await tryLoadRemote(storedUrl, storedMode);
    if (!applied && manifestUrl && isHttpsUrl(manifestUrl)) applied = await tryLoadRemote(manifestUrl, storedMode);
    if (!applied) applied = await tryLoadPackaged();

    try {
        await browser.oauthpatch.init();
        console.log("[OAuthPatch] bootstrap complete (applied:", applied, ")");
    } catch (e) {
        console.warn("[OAuthPatch] bootstrap: init failed:", e?.message || e);
    }
}

browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    const mode = (await browser.storage.local.get("storeSecret")).storeSecret || "prefs";
    if (changes.configUrl) {
        const u = changes.configUrl.newValue || "";
        if (u && isHttpsUrl(u)) {
            const ok = await tryLoadRemote(u, mode);
            if (ok) {
                await browser.oauthpatch.init();
                console.log("[OAuthPatch] Reloaded config due to URL change");
            }
        }
    }
});

bootstrap();

browser.runtime.onInstalled.addListener(() => {
    if (browser.runtime.openOptionsPage) browser.runtime.openOptionsPage();
});

browser.runtime.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "oauthpatch.fetchConfig") return;
    try {
        const json = await fetchJsonWithTimeout(msg.url);
        return { ok: true, json };
    } catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
});
