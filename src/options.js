(async function () {
    const $unified = document.getElementById('configUnified');
    const $browse  = document.getElementById('browseBtn');
    const $applyU  = document.getElementById('applyUnified');
    const $picker  = document.getElementById('filePicker');

    const $paste = document.getElementById('pasteJson');
    const $st    = document.getElementById('status');

    const MAX_FILE_BYTES = 128 * 1024;

    let lastPickedFileName = null;
    let lastPickedJsonText = null;

    const setStatus = (msg, ok = true) => { $st.textContent = msg; $st.className = ok ? 'ok' : 'err'; };

    function getStoreMode() {
        const r = document.querySelector('input[name="storeSecret"]:checked');
        return (r && r.value) || 'prefs';
    }
    function setStoreMode(v) {
        const val = v || 'prefs';
        const el = document.querySelector(`input[name="storeSecret"][value="${val}"]`);
        if (el) el.checked = true;
    }

    async function loadState() {
        const { configUrl = '', storeSecret = 'prefs' } =
            await browser.storage.local.get(['configUrl', 'storeSecret']);

        if (configUrl && !$unified.value) {
            $unified.placeholder ||= `Paste JSON {…}, or enter ${configUrl}, or click Browse for a file`;
        }
        setStoreMode(storeSecret);
    }

    function detectKindFromInput(text) {
        const v = (text || '').trim();
        if (v.startsWith('file:')) return 'file';
        if (v.startsWith('{') || v.startsWith('[')) return 'inline-json';
        if (/^https:\/\//i.test(v)) return 'https-url';
        return 'unknown';
    }

    async function bgFetchJson(u) {
        const res = await browser.runtime.sendMessage({ type: "oauthpatch.fetchConfig", url: u });
        if (!res || !res.ok) throw new Error(res?.error || "Fetch failed");
        return res.json;
    }

    async function applyConfigObject(json) {
        const mode = getStoreMode();
        await browser.storage.local.set({ storeSecret: mode });
        await browser.oauthpatch.applyConfig(json, { force: true, storeSecret: mode });
        await browser.oauthpatch.init();
    }

    async function applyUnified() {
        const v = ($unified.value || '').trim();
        const kind = detectKindFromInput(v);

        try {
            if (kind === 'file') {
                if (!lastPickedJsonText) throw new Error('No file bound. Click Browse and pick a JSON file.');
                const json = JSON.parse(lastPickedJsonText);
                await applyConfigObject(json);
                setStatus(`Applied file: ${lastPickedFileName || 'local JSON'}`);
                return;
            }

            if (kind === 'inline-json') {
                const json = JSON.parse(v);
                await applyConfigObject(json);
                setStatus('Applied inline JSON');
                return;
            }

            if (kind === 'https-url') {
                const json = await bgFetchJson(v);
                const mode = getStoreMode();
                await browser.storage.local.set({ configUrl: v, storeSecret: mode });
                await browser.oauthpatch.applyConfig(json, { force: true, storeSecret: mode });
                await browser.oauthpatch.init();
                setStatus('Config fetched and applied from URL');
                return;
            }

            setStatus('Provide an https URL, paste JSON, or choose a file (Browse).', false);
        } catch (e) {
            setStatus(e.message || String(e), false);
        }
    }

    async function onPickFile(ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        if (f.size > MAX_FILE_BYTES) {
            setStatus('File too large (max 128 KB)', false);
            return;
        }
        try {
            const text = await f.text();
            JSON.parse(text); // sanity
            lastPickedJsonText = text;
            lastPickedFileName = f.name;
            $unified.value = `file:${f.name}`;
            setStatus(`File loaded: ${f.name} (ready to Apply)`);
        } catch (e) {
            lastPickedJsonText = null;
            lastPickedFileName = null;
            setStatus('Invalid JSON in file: ' + e.message, false);
        } finally {
            ev.target.value = '';
        }
    }

    $browse.addEventListener('click', () => $picker.click());
    $picker.addEventListener('change', onPickFile);
    $applyU.addEventListener('click', () => applyUnified().catch(e => setStatus(e.message, false)));

    document.getElementById('applyJson').addEventListener('click', () =>
        (async () => {
            try {
                const json = JSON.parse($paste.value);
                await applyConfigObject(json);
                setStatus('Pasted JSON applied');
            } catch (e) { setStatus('Invalid JSON: ' + e.message, false); }
        })().catch(e => setStatus(e.message, false))
    );

    document.getElementById('loadProfile').addEventListener('click', () =>
        (async () => {
            const mode = getStoreMode();
            await browser.storage.local.set({ storeSecret: mode });
            await browser.oauthpatch.loadAndApplyFromProfile('oauthpatch.json', { force: true, storeSecret: mode });
            await browser.oauthpatch.init();
            setStatus('Profile config applied');
        })().catch(e => setStatus(e.message, false))
    );

    document.getElementById('resetSecret').addEventListener('click', () =>
        browser.oauthpatch.resetSecret()
            .then(() => setStatus('Secret removed from prefs & Login Manager'))
            .catch(e => setStatus(e.message, false))
    );

    await loadState();
})();
