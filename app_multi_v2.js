// ============================
// PWA-GLPI v2 — app_multi_v2.js
// ============================
// Conserve toute la logique v1 (scan + maj inventory_date) et ajoute :
//   - Récupération Infocom complet (id + buy_date + inventory_date)
//   - Recherche en mode "lecture seule" (sans forcer la maj)
//   - Mise à jour optionnelle de users_id sur l'item
//   - Mise à jour optionnelle de buy_date + inventory_date sur l'Infocom
//   - Chargement de la liste des utilisateurs GLPI (filtrée par email)
//   - Wrapper `glpiFetch` avec retry automatique sur 401 (session expirée)
// ============================

// ============================
// Configuration GLPI (injectée par config.js — chargé avant ce script)
// ============================
if (!window.GLPI_CONFIG) {
    throw new Error("window.GLPI_CONFIG manquant — config.js doit être chargé avant app_multi_v2.js");
}
const GLPI_CONFIG = window.GLPI_CONFIG;

let sessionToken = null;
let codeReader = null;
let currentFacing = "environment";
window._activeStream = null;

// Cache de la liste des utilisateurs pour éviter de recharger à chaque recherche
let _glpiUsersCache = null;
// Cache des numéros de searchOption pour User (email varie selon GLPI)
let _userSearchOptions = null;

// utilitaires DOM
function getLogsElement() { return document.getElementById("logs"); }
function getResultElement() { return document.getElementById("result"); }

// ============================
// v4.1 : Toast de confirmation (pop-up après opération d'écriture)
// ============================
// Délai par défaut avant auto-close d'un toast succès (réglable ici).
const TOAST_AUTO_CLOSE_MS = 5000;

// API : showToast(level, title, { desc, autoCloseMs, onClose })
//   level       : "success" | "error"
//   title       : texte en gras (ex: "Mise à jour OK")
//   desc        : ligne descriptive (ex: nom de l'équipement)
//   autoCloseMs : en ms, déclenche la fermeture + onClose automatiquement (success)
//   onClose     : callback invoqué à la fermeture (auto ou manuelle)
//
// Un seul toast visible à la fois. Si un autre est déjà affiché, il est remplacé.
const TOAST_SVG = {
    success: '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
    error:   '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>'
};

let _toastState = {
    timer: null,
    raf: null,
    onClose: null,
    closing: false
};

function _clearToastTimers() {
    if (_toastState.timer) { clearTimeout(_toastState.timer); _toastState.timer = null; }
    if (_toastState.raf)   { cancelAnimationFrame(_toastState.raf); _toastState.raf = null; }
}

// Ferme le toast visible (auto ou manuelle) — exécute onClose une seule fois.
function closeToast(reason) {
    const host = document.getElementById("toast-host");
    if (!host || _toastState.closing) return;
    _toastState.closing = true;
    _clearToastTimers();

    const toast = host.querySelector(".toast");
    const cb = _toastState.onClose;
    _toastState.onClose = null;

    const finalize = () => {
        host.innerHTML = "";
        host.setAttribute("hidden", "");
        _toastState.closing = false;
        if (typeof cb === "function") {
            try { cb(reason || "manual"); } catch (e) { log("warning", "toast onClose error", e.message || e); }
        }
    };

    if (!toast) { finalize(); return; }
    toast.classList.add("toast--closing");
    // durée CSS = 200ms — on nettoie juste après
    setTimeout(finalize, 220);
}

function showToast(level, title, options = {}) {
    const host = document.getElementById("toast-host");
    if (!host) {
        log("warning", "toast-host absent — fallback console");
        console.log(`[toast:${level}] ${title}`, options);
        return;
    }

    // Si un toast est déjà visible, on le remplace proprement (sans rejouer onClose)
    if (!host.hasAttribute("hidden")) {
        _clearToastTimers();
        _toastState.onClose = null;
        host.innerHTML = "";
    }
    _toastState.closing = false;

    const safeLevel = (level === "error") ? "error" : "success";
    const desc = options.desc || "";
    const autoCloseMs = (safeLevel === "success" && typeof options.autoCloseMs === "number")
        ? options.autoCloseMs : null;
    _toastState.onClose = typeof options.onClose === "function" ? options.onClose : null;

    const toast = document.createElement("div");
    toast.className = `toast toast--${safeLevel}`;
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");
    toast.innerHTML = `
        <div class="toast__icon" aria-hidden="true">${TOAST_SVG[safeLevel]}</div>
        <div class="toast__body">
            <div class="toast__title"></div>
            <div class="toast__desc"></div>
        </div>
        <button type="button" class="toast__close" aria-label="Fermer la notification">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
            </svg>
        </button>
        ${autoCloseMs ? '<div class="toast__progress"><div class="toast__progress-bar"></div></div>' : ''}
    `;
    // textContent pour éviter toute injection HTML côté title/desc
    toast.querySelector(".toast__title").textContent = title || "";
    const descEl = toast.querySelector(".toast__desc");
    if (desc) descEl.textContent = desc; else descEl.remove();

    host.appendChild(toast);
    host.removeAttribute("hidden");

    const closeBtn = toast.querySelector(".toast__close");
    closeBtn.addEventListener("click", () => closeToast("manual"));

    // Focus transféré sur "Fermer" à l'apparition (accessibilité)
    setTimeout(() => { try { closeBtn.focus({ preventScroll: true }); } catch(_) { closeBtn.focus(); } }, 50);

    if (autoCloseMs) {
        const bar = toast.querySelector(".toast__progress-bar");
        const start = performance.now();
        const tick = (now) => {
            const elapsed = now - start;
            const pct = Math.max(0, 1 - elapsed / autoCloseMs);
            if (bar) bar.style.transform = `scaleX(${pct})`;
            if (elapsed < autoCloseMs) {
                _toastState.raf = requestAnimationFrame(tick);
            }
        };
        _toastState.raf = requestAnimationFrame(tick);
        _toastState.timer = setTimeout(() => closeToast("auto"), autoCloseMs);
    }
}

// Exposition globale (utilisée par recherche_manuelle.html)
window.showToast = showToast;
window.closeToast = closeToast;

// ============================
// Logging + persistance locale (v4.1.1)
// ============================
// Tous les appels log() sont :
//   1) affichés en console navigateur
//   2) ajoutés à un buffer mémoire, miroré dans localStorage (ring 500 entrées)
//   3) ajoutés au DOM (#logs)
// Le buffer est téléchargeable à la demande via downloadLogs() — permet de
// récupérer toutes les traces (y compris issues des sessions précédentes).
const LOG_STORAGE_KEY = "pwa-glpi-log-buffer";
const LOG_MAX_ENTRIES = 500;
let _logBuffer = [];
try {
    const stored = localStorage.getItem(LOG_STORAGE_KEY);
    if (stored) _logBuffer = JSON.parse(stored) || [];
} catch (_) { _logBuffer = []; }

function _persistLogBuffer() {
    try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(_logBuffer)); }
    catch (_) { /* quota / privacy mode — best effort */ }
}

function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    // 1 : console
    if (data) console.log(entry, data); else console.log(entry);

    // 2 : buffer mémoire + localStorage (persistance inter-sessions)
    _logBuffer.push({ ts: timestamp, level, message, data });
    if (_logBuffer.length > LOG_MAX_ENTRIES) {
        _logBuffer = _logBuffer.slice(-LOG_MAX_ENTRIES);
    }
    _persistLogBuffer();

    // 3 : DOM (#logs)
    const logsEl = getLogsElement();
    if (!logsEl) return;
    const d = document.createElement("div");
    d.className = `log-${level}`;
    d.textContent = entry;
    if (data) d.textContent += "\n" + JSON.stringify(data, null, 2);
    logsEl.appendChild(d);
    logsEl.scrollTop = logsEl.scrollHeight;
}

// Télécharge tout le buffer courant (mémoire + localStorage) dans un .txt.
function downloadLogs() {
    const lines = _logBuffer.map(e => {
        let row = `[${e.ts}] [${(e.level || "info").toUpperCase()}] ${e.message}`;
        if (e.data) row += "\n    " + JSON.stringify(e.data);
        return row;
    });
    const header = [
        `# PWA-GLPI logs — export ${new Date().toISOString()}`,
        `# entries: ${_logBuffer.length} (max buffer: ${LOG_MAX_ENTRIES})`,
        `# user-agent: ${navigator.userAgent}`,
        `# url: ${location.href}`,
        ""
    ].join("\n");
    const blob = new Blob([header + lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pwa-glpi-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    log("info", `Logs exportés (${_logBuffer.length} entrées)`);
}

// Vide le buffer (mémoire + localStorage) et le DOM.
function clearAllLogs() {
    _logBuffer = [];
    try { localStorage.removeItem(LOG_STORAGE_KEY); } catch (_) {}
    const logsEl = getLogsElement();
    if (logsEl) logsEl.innerHTML = "";
}

window.downloadLogs = downloadLogs;
window.clearAllLogs = clearAllLogs;

// ============================
// Session GLPI
// ============================
async function initGLPISession() {
    log("info", "Initialisation de la session GLPI...");
    const headers = {
        "App-Token": GLPI_CONFIG.APP_TOKEN,
        "Authorization": "user_token " + GLPI_CONFIG.USER_TOKEN,
        "Content-Type": "application/json"
    };
    const resp = await fetch(`${GLPI_CONFIG.URL}initSession`, { method: "GET", headers });
    if (!resp.ok) throw new Error(`Erreur initSession ${resp.status}`);
    const data = await resp.json();
    sessionToken = data.session_token;
    log("success", "Session GLPI initialisée");
    return sessionToken;
}

function getAuthHeaders() {
    if (!sessionToken) throw new Error("Session non initialisée");
    return { "App-Token": GLPI_CONFIG.APP_TOKEN, "Session-Token": sessionToken, "Content-Type": "application/json" };
}

// ============================
// glpiFetch — wrapper fetch avec auto-auth + retry unique sur 401
// ============================
// Gère :
//   - init session si absente
//   - merge des headers d'auth avec les options fournies
//   - sur 401 : reset du sessionToken, re-init, et un seul retry
async function glpiFetch(url, options = {}) {
    if (!sessionToken) await initGLPISession();

    const buildRequestInit = () => ({
        ...options,
        headers: { ...getAuthHeaders(), ...(options.headers || {}) }
    });

    let resp = await fetch(url, buildRequestInit());
    if (resp.status === 401) {
        log("warning", `401 sur ${url} — reconnexion et retry`);
        sessionToken = null;
        await initGLPISession();
        resp = await fetch(url, buildRequestInit());
    }
    return resp;
}

function formatDateForGLPI(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// Normalise une date GLPI (YYYY-MM-DD HH:MM:SS ou YYYY-MM-DD) pour <input type="date">
function toInputDate(glpiDate) {
    if (!glpiDate) return "";
    const s = String(glpiDate).trim();
    if (s.length >= 10) return s.substring(0, 10);
    return "";
}

// ============================
// v1: Recherche + update automatique inventory_date (flow scan)
// ============================
async function searchAndUpdate(serialNumber, equipmentType) {
    const url =
        `${GLPI_CONFIG.URL}search/${equipmentType}?range=0-99` +
        `&criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]=${encodeURIComponent(serialNumber)}` +
        `&forcedisplay[0]=1&forcedisplay[1]=2&forcedisplay[2]=5&forcedisplay[3]=125&forcedisplay[4]=7`;

    const resp = await glpiFetch(url);
    if (!resp.ok) return { found: false, itemName: null, infocomOk: false };
    const data = await resp.json();
    if (!data.data || data.data.length === 0) return { found: false, itemName: null, infocomOk: false };

    const item = data.data[0];
    const itemId = item[2] || item["2"];
    const itemName = item[1] || item["1"] || "—";
    const lastInv = item[125] || item["125"] || null;
    const contact = item[7] || item["7"] || "Non renseigné";

    log("success", `${equipmentType} trouvé`, { id: itemId, name: itemName, contact, dernierInventaire: lastInv });

    const resEl = getResultElement();
    if (resEl) {
        const infoDiv = document.createElement("div");
        infoDiv.style.marginTop = "10px";
        infoDiv.style.padding = "10px";
        infoDiv.style.background = "#f8f9fa";
        infoDiv.style.borderRadius = "5px";
        infoDiv.innerHTML = `
            <p><b>Nom :</b> ${itemName}</p>
            <p><b>Usager :</b> ${contact}</p>
            <p><b>Dernier inventaire :</b> ${lastInv || "Jamais"}</p>
        `;
        resEl.appendChild(infoDiv);
    }

    const infocomOk = await updateInfocomDate(equipmentType, itemId);
    return { found: true, itemName, infocomOk };
}

async function updateInfocomDate(equipmentType, itemId) {
    log("info", `Mise à jour Infocom pour ${equipmentType} ${itemId}`);
    const infocom = await getInfocom(equipmentType, itemId);
    if (!infocom || !infocom.id) {
        log("warning", `Pas d'Infocom trouvé pour ${equipmentType} ${itemId}`);
        return false;
    }
    const infocomUrl = `${GLPI_CONFIG.URL}Infocom/${infocom.id}`;
    const today = formatDateForGLPI();
    const updateData = { input: { id: parseInt(infocom.id), inventory_date: today } };

    const updateResp = await glpiFetch(infocomUrl, {
        method: "PUT",
        body: JSON.stringify(updateData)
    });

    if (updateResp.ok) {
        log("success", `Date inventaire mise à jour pour ${equipmentType} ${itemId}`, { date: today });
        return true;
    } else {
        const errorText = await updateResp.text();
        log("error", `Échec mise à jour Infocom pour ${equipmentType} ${itemId}: ${errorText}`);
        return false;
    }
}

// ============================
// v2: Lecture seule (pas de PUT automatique)
// ============================
async function searchItemOnly(serialNumber, equipmentType) {
    const url =
        `${GLPI_CONFIG.URL}search/${equipmentType}?range=0-99` +
        `&criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]=${encodeURIComponent(serialNumber)}` +
        `&forcedisplay[0]=1&forcedisplay[1]=2&forcedisplay[2]=5&forcedisplay[3]=125&forcedisplay[4]=7`;

    const resp = await glpiFetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.data || data.data.length === 0) return null;

    const item = data.data[0];
    return {
        type: equipmentType,
        id: item[2] || item["2"],
        name: item[1] || item["1"] || "—",
        serial: item[5] || item["5"] || "",
        lastInventory: item[125] || item["125"] || null,
        contact: item[7] || item["7"] || "Non renseigné"
    };
}

// Recherche un équipement dans tous les types et retourne les infos + infocom
async function findEquipment(serialNumber) {
    const types = ["Computer", "Monitor", "Peripheral", "NetworkEquipment", "Phone"];
    for (const t of types) {
        const found = await searchItemOnly(serialNumber, t);
        if (found) {
            log("success", `${t} trouvé`, found);
            // Charge les infos complètes (incluant users_id)
            const itemFull = await getItem(t, found.id);
            const infocom = await getInfocom(t, found.id);
            return { ...found, full: itemFull, infocom };
        }
    }
    return null;
}

// Retourne l'item complet (permet de lire users_id)
async function getItem(equipmentType, itemId) {
    try {
        const resp = await glpiFetch(`${GLPI_CONFIG.URL}${equipmentType}/${itemId}`);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        log("warning", `Erreur getItem ${equipmentType}/${itemId}`, e.message || e);
        return null;
    }
}

// Retourne l'Infocom associé (id, buy_date, inventory_date, ...)
async function getInfocom(equipmentType, itemId) {
    try {
        const relationUrl = `${GLPI_CONFIG.URL}${equipmentType}/${itemId}/Infocom/`;
        const relationResp = await glpiFetch(relationUrl);
        if (!relationResp.ok) return null;
        const relationData = await relationResp.json();
        if (Array.isArray(relationData) && relationData.length > 0) return relationData[0];
        if (relationData && relationData.id) return relationData;
        return null;
    } catch (e) {
        log("warning", "Erreur getInfocom", e.message || e);
        return null;
    }
}

// ============================
// v2: Update users_id sur l'item
// ============================
async function updateItemUser(equipmentType, itemId, usersId) {
    const url = `${GLPI_CONFIG.URL}${equipmentType}/${itemId}`;
    const payload = { input: { id: parseInt(itemId), users_id: usersId === null || usersId === "" ? 0 : parseInt(usersId) } };
    const resp = await glpiFetch(url, { method: "PUT", body: JSON.stringify(payload) });
    if (!resp.ok) {
        const t = await resp.text();
        log("error", `Échec PUT ${equipmentType}/${itemId} users_id: ${t}`);
        return false;
    }
    log("success", `users_id mis à jour sur ${equipmentType}/${itemId}`, { users_id: payload.input.users_id });
    return true;
}

// ============================
// v2: Update Infocom (inventory_date + buy_date, optionnel)
// ============================
async function updateInfocomFields(infocomId, { inventoryDate = null, dateBuy = null }) {
    if (!infocomId) return false;
    const input = { id: parseInt(infocomId) };
    if (inventoryDate !== null) input.inventory_date = inventoryDate;
    if (dateBuy !== null) input.buy_date = dateBuy;

    // Rien à changer : on évite l'appel réseau
    if (Object.keys(input).length === 1) return true;

    const resp = await glpiFetch(`${GLPI_CONFIG.URL}Infocom/${infocomId}`, {
        method: "PUT",
        body: JSON.stringify({ input })
    });
    if (!resp.ok) {
        const t = await resp.text();
        log("error", `Échec PUT Infocom/${infocomId}: ${t}`);
        return false;
    }
    log("success", `Infocom ${infocomId} mis à jour`, input);
    return true;
}

// ============================
// v2: Liste des utilisateurs GLPI (filtrée par email)
// ============================

// Découvre les numéros de searchOption pour le type User (email notamment)
// en appelant /listSearchOptions/User. Fallback sur login/id si indisponible.
async function discoverUserSearchOptions() {
    if (_userSearchOptions) return _userSearchOptions;
    const fallback = { id: 2, login: 1, email: null };
    try {
        const resp = await glpiFetch(`${GLPI_CONFIG.URL}listSearchOptions/User`);
        if (!resp.ok) {
            log("warning", `listSearchOptions/User HTTP ${resp.status} — fallback login uniquement`);
            _userSearchOptions = fallback;
            return _userSearchOptions;
        }
        const opts = await resp.json();
        const findByNames = (patterns) => {
            for (const [key, val] of Object.entries(opts)) {
                if (!val || typeof val !== "object") continue;
                const label = String(val.name || "").toLowerCase();
                const field = String(val.field || "").toLowerCase();
                const table = String(val.table || "").toLowerCase();
                if (patterns.some(p => label.includes(p) || field === p || table.includes(p))) {
                    const n = parseInt(key);
                    if (!Number.isNaN(n)) return n;
                }
            }
            return null;
        };
        _userSearchOptions = {
            id: 2,
            login: 1,
            email: findByNames(["email", "e-mail", "courriel", "useremails"])
        };
        log("info", "User searchOptions découverts", _userSearchOptions);
    } catch (e) {
        log("warning", `Erreur discoverUserSearchOptions: ${e.message || e} — fallback login`);
        _userSearchOptions = fallback;
    }
    return _userSearchOptions;
}

async function loadGLPIUsers() {
    if (_glpiUsersCache) return _glpiUsersCache;
    const opts = await discoverUserSearchOptions();
    const displayOpts = [opts.login, opts.id];
    if (opts.email) displayOpts.push(opts.email);
    const params = displayOpts.map((o, i) => `forcedisplay[${i}]=${o}`).join("&");
    const url = `${GLPI_CONFIG.URL}search/User?range=0-500&${params}`;

    let resp;
    try {
        resp = await glpiFetch(url);
    } catch (e) {
        log("error", `Échec réseau search/User: ${e.message || e}`);
        throw new Error(`Réseau: ${e.message || e}`);
    }
    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        log("error", `Échec chargement users (HTTP ${resp.status})`, { url, body: body.slice(0, 500) });
        throw new Error(`HTTP ${resp.status} sur search/User${body ? " — " + body.slice(0, 200) : ""}`);
    }
    const data = await resp.json();
    log("info", "Réponse brute search/User", {
        totalcount: data.totalcount,
        count: data.count,
        first: (data.data || [])[0] || null
    });

    const pick = (row, optNum) => {
        if (!optNum) return "";
        const v = row[optNum] != null ? row[optNum] : row[String(optNum)];
        if (v == null) return "";
        // GLPI renvoie parfois les emails sous forme de tableau, ou une chaîne séparée par <br> ou ,
        if (Array.isArray(v)) return v.filter(Boolean).join(", ");
        return String(v).replace(/<br\s*\/?>/gi, ", ").trim();
    };

    const rows = data.data || [];
    const allUsers = rows.map(r => {
        const id = pick(r, opts.id) || r[2] || r["2"];
        const login = pick(r, opts.login) || r[1] || r["1"] || "";
        const email = pick(r, opts.email);
        return { id, login, email, name: email };
    }).filter(u => u.id && u.email);

    // Tri alphabétique par email
    allUsers.sort((a, b) => String(a.email).localeCompare(String(b.email)));

    _glpiUsersCache = allUsers;
    const skipped = rows.length - allUsers.length;
    log("info", `Liste utilisateurs chargée (${allUsers.length} avec email, ${skipped} ignorés sans email)`);
    return allUsers;
}

// ============================
// Caméra / Scanner (identique v1)
// ============================
function stopCurrentStream() {
    if (codeReader) { try { codeReader.reset(); } catch(_){}; codeReader = null; }
    if (window._activeStream) { window._activeStream.getTracks().forEach(t => t.stop()); window._activeStream = null; }
    const v = document.getElementById("video"); if (v) v.srcObject = null;
}

async function startScanner() {
    const video = document.getElementById("video");
    const resultDiv = getResultElement();
    stopCurrentStream();
    codeReader = new ZXing.BrowserMultiFormatReader();

    try {
        await codeReader.decodeFromConstraints(
            { video: { facingMode: currentFacing } },
            video,
            async (result, err) => {
                if (result) {
                    const serialRaw = result.getText();
                    stopCurrentStream();
                    if (resultDiv) resultDiv.innerHTML = `<p>Code scanné: <b>${serialRaw}</b></p><div id="test-result"></div>`;
                    document.getElementById("rescan-button").style.display = "block";
                    document.getElementById("switch-button").style.display = "block";
                    await handleSerial(serialRaw);
                }
                if (err && !(err instanceof ZXing.NotFoundException)) log("error", "Erreur decode", err.message || err);
            }
        );
    } catch (e) {
        log("error", "Erreur startScanner", e.message || e);
    }
}

async function handleSerial(serialRaw) {
    const serialNumber = serialRaw.includes("=") ? serialRaw.split("=")[1].trim() : serialRaw.trim();

    // v4 : aiguillage selon le mode choisi
    if (getScanMode() === "manuel") {
        await handleSerialManuel(serialNumber);
        return;
    }

    // Mode inventaire (comportement historique) : MAJ auto de inventory_date
    const types = ["Computer", "Monitor", "Peripheral", "NetworkEquipment", "Phone"];
    let found = false;
    let infocomOk = false;
    let foundName = null;
    let networkError = null;
    try {
        for (const t of types) {
            const res = await searchAndUpdate(serialNumber, t);
            if (res && res.found) {
                found = true;
                infocomOk = !!res.infocomOk;
                foundName = res.itemName;
                break;
            }
        }
    } catch (e) {
        log("error", "Erreur handleSerial (inventaire)", e.message || e);
        networkError = e.message || String(e);
    }

    const out = document.getElementById("test-result");
    out.innerHTML = "";
    const success = found && infocomOk && !networkError;

    if (success) {
        out.innerHTML = `<div style="background:#d4edda;color:#155724;padding:10px;border-radius:5px;">
            ✅ Inventaire mis à jour pour ${serialNumber}
        </div>`;
        // v4.1 : toast de confirmation + auto-rescan après 10s
        showToast("success", "Mise à jour OK", {
            desc: `Inventaire à jour pour ${foundName || serialNumber}`,
            autoCloseMs: TOAST_AUTO_CLOSE_MS,
            onClose: () => {
                const rescan = document.getElementById("rescan-button");
                if (rescan) rescan.click();
            }
        });
    } else {
        // Détermine la raison précise pour l'UX
        let errTitle, errDesc;
        if (networkError) {
            errTitle = "Erreur réseau";
            errDesc = `Impossible de contacter GLPI : ${networkError}`;
        } else if (!found) {
            errTitle = "Équipement introuvable";
            errDesc = `Aucun équipement pour ${serialNumber}`;
        } else {
            errTitle = "Échec de la mise à jour";
            errDesc = `Infocom non mis à jour pour ${foundName || serialNumber}`;
        }
        out.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">
            ❌ ${errDesc}
        </div>`;
        // v4.1 : toast d'échec (pas d'auto-close, reste jusqu'à fermeture manuelle)
        showToast("error", errTitle, { desc: errDesc });
    }
}

// ============================
// v4 : Mode de scan (Inventaire / Manuel) + édition manuelle via QR
// ============================
const SCAN_MODE_KEY = "pwa-glpi-scan-mode";

function getScanMode() {
    return localStorage.getItem(SCAN_MODE_KEY) === "manuel" ? "manuel" : "inventaire";
}

function setScanMode(mode) {
    const m = (mode === "manuel") ? "manuel" : "inventaire";
    localStorage.setItem(SCAN_MODE_KEY, m);
    updateScanModeUI();
    if (m === "inventaire") resetManualForm();
}

function updateScanModeUI() {
    const mode = getScanMode();
    document.querySelectorAll(".mode-btn").forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle("mode-btn--active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const subtitle = document.getElementById("scan-subtitle");
    if (subtitle) {
        subtitle.textContent = (mode === "inventaire")
            ? "Pointez le QR Code pour mettre à jour la date d'inventaire (maj automatique au scan)."
            : "Pointez le QR Code pour éditer l'équipement (utilisateur, date d'achat, date d'inventaire).";
    }
}

// État courant de l'équipement en cours d'édition manuelle
let _manualCurrentEquip = null;

function resetManualForm() {
    _manualCurrentEquip = null;
    const form = document.getElementById("manual-edit-form");
    if (form) form.classList.add("hidden");
}

// Remplit un <select> avec la liste des utilisateurs GLPI (filtrée par email).
// Exposée globalement pour que recherche_manuelle.html puisse aussi l'utiliser.
async function populateUsersSelect(selectEl, selectedId, outEl) {
    try {
        const users = await loadGLPIUsers();
        selectEl.innerHTML = '<option value="0">— Aucun —</option>';
        for (const u of users) {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = u.name;
            if (selectedId && String(u.id) === String(selectedId)) opt.selected = true;
            selectEl.appendChild(opt);
        }
        if (!selectedId || selectedId === 0 || selectedId === "0") {
            selectEl.value = "0";
        }
        if (users.length === 0 && outEl) {
            outEl.innerHTML = `<div style="background:#d1ecf1;color:#0c5460;padding:10px;border-radius:5px;">
                ⚠ Liste utilisateurs vide — vérifier les droits du token sur search/User (voir logs)
            </div>`;
            const logs = document.getElementById("logs");
            if (logs) logs.style.display = "block";
        }
    } catch (e) {
        selectEl.innerHTML =
            `<option value="" disabled selected>❌ ${e.message || e}</option>` +
            `<option value="0">— Aucun —</option>`;
        if (outEl) outEl.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">
            ❌ Liste utilisateurs indisponible : ${e.message || e}
        </div>`;
        const logs = document.getElementById("logs");
        if (logs) logs.style.display = "block";
    }
}

// Rend les infos d'un équipement trouvé dans un élément cible.
// IMPORTANT : on préserve/recrée le `#test-result` imbriqué car saveManualEdit
// (et d'autres handlers) le cherchent après-coup — sinon crash "null is not an
// object (evaluating 'out')" sur le clic Enregistrer en mode Manuel via QR.
function renderEquipmentInfo(targetEl, eq) {
    const inv = eq.infocom || {};
    targetEl.innerHTML = `
        <div class="info-box">
            <p><b>Type :</b> ${eq.type}</p>
            <p><b>Nom :</b> ${eq.name}</p>
            <p><b>N° de série :</b> ${eq.serial || "—"}</p>
            <p><b>Dernier inventaire :</b> ${eq.lastInventory || "Jamais"}</p>
            <p><b>Date d'achat actuelle :</b> ${inv.buy_date || "Non renseignée"}</p>
            <p><b>Infocom ID :</b> ${inv.id || "—"}</p>
        </div>
        <div id="test-result"></div>
    `;
}

// Scan en mode Manuel : recherche l'équipement et affiche le formulaire d'édition.
async function handleSerialManuel(serialNumber) {
    const resEl = getResultElement();
    const out = document.getElementById("test-result");
    const form = document.getElementById("manual-edit-form");

    if (out) out.innerHTML = `<div style="background:#d1ecf1;color:#0c5460;padding:10px;border-radius:5px;">🔎 Recherche ${serialNumber}…</div>`;

    const eq = await findEquipment(serialNumber);
    if (!eq) {
        if (out) out.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">
            ❌ Aucun équipement trouvé pour ${serialNumber}
        </div>`;
        resetManualForm();
        return;
    }

    _manualCurrentEquip = eq;

    if (resEl) renderEquipmentInfo(resEl, eq);

    const usersSelect = document.getElementById("usersSelect");
    const dateBuyIn   = document.getElementById("dateBuy");
    const invChk      = document.getElementById("updateInventoryDate");

    const itemFull = eq.full && (eq.full.users_id !== undefined ? eq.full : (eq.full[eq.type] || {}));
    const currentUserId = itemFull && itemFull.users_id !== undefined ? itemFull.users_id : 0;

    if (usersSelect) await populateUsersSelect(usersSelect, currentUserId, out);
    if (dateBuyIn)   dateBuyIn.value = toInputDate(eq.infocom && eq.infocom.buy_date);
    if (invChk)      invChk.checked = true;

    if (form) form.classList.remove("hidden");

    if (out) out.innerHTML = `<div style="background:#d1ecf1;color:#0c5460;padding:10px;border-radius:5px;">
        ✅ ${eq.type} trouvé — modifiez les champs puis cliquez sur « Enregistrer »
    </div>`;
}

// Enregistre les modifications du formulaire manuel pour l'équipement scanné.
async function saveManualEdit() {
    if (!_manualCurrentEquip) return;
    const eq = _manualCurrentEquip;
    const usersSelect = document.getElementById("usersSelect");
    const dateBuyIn   = document.getElementById("dateBuy");
    const invChk      = document.getElementById("updateInventoryDate");
    const out         = document.getElementById("test-result");
    const saveBtn     = document.getElementById("manual-save-btn");

    const selectedUserId = usersSelect.value;
    const dateBuy = dateBuyIn.value || null;
    const doInv = invChk.checked;

    const itemFull = eq.full && (eq.full.users_id !== undefined ? eq.full : (eq.full[eq.type] || {}));
    const prevUserId = itemFull && itemFull.users_id !== undefined ? String(itemFull.users_id) : "0";
    const prevDateBuy = toInputDate(eq.infocom && eq.infocom.buy_date);

    try {
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Enregistrement…"; }
        const actions = [];

        if (String(selectedUserId) !== prevUserId) {
            const ok = await updateItemUser(eq.type, eq.id, selectedUserId);
            actions.push({ what: "users_id", ok });
        }

        const infocomId = eq.infocom && eq.infocom.id;
        const dateBuyChanged = (dateBuy || "") !== (prevDateBuy || "");
        if (infocomId && (dateBuyChanged || doInv)) {
            const payload = {};
            if (doInv) payload.inventoryDate = formatDateForGLPI();
            if (dateBuyChanged) payload.dateBuy = dateBuy;
            const ok = await updateInfocomFields(infocomId, payload);
            actions.push({ what: "infocom", ok, payload });
        } else if (!infocomId && (dateBuyChanged || doInv)) {
            log("warning", "Pas d'Infocom — impossible de mettre à jour buy_date / inventory_date");
            actions.push({ what: "infocom", ok: false, reason: "no_infocom" });
        }

        let allOk = true;
        if (actions.length === 0) {
            out.innerHTML = `<div style="background:#d1ecf1;color:#0c5460;padding:10px;border-radius:5px;">ℹ Aucune modification à enregistrer</div>`;
            // Aucune opération d'écriture → pas de toast
        } else {
            allOk = actions.every(a => a.ok);
            out.innerHTML = allOk
                ? `<div style="background:#d4edda;color:#155724;padding:10px;border-radius:5px;">✅ Modifications enregistrées pour ${eq.name}</div>`
                : `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">⚠ Enregistrement partiel — consultez les logs</div>`;
        }

        // Rafraîchir les infos affichées
        const refreshed = await findEquipment(eq.serial);
        if (refreshed) {
            _manualCurrentEquip = refreshed;
            const resEl = getResultElement();
            if (resEl) renderEquipmentInfo(resEl, refreshed);
            invChk.checked = false;
            const itemFull2 = refreshed.full && (refreshed.full.users_id !== undefined ? refreshed.full : (refreshed.full[refreshed.type] || {}));
            const curUid = itemFull2 && itemFull2.users_id !== undefined ? itemFull2.users_id : 0;
            await populateUsersSelect(usersSelect, curUid, out);
            dateBuyIn.value = toInputDate(refreshed.infocom && refreshed.infocom.buy_date);
        }

        // v4.1 : toast de confirmation (seulement si au moins une action d'écriture)
        if (actions.length > 0) {
            if (allOk) {
                showToast("success", "Mise à jour OK", {
                    desc: `Modifications enregistrées pour ${eq.name}`,
                    autoCloseMs: TOAST_AUTO_CLOSE_MS,
                    onClose: () => {
                        // Reset du formulaire manuel + relance scan
                        resetManualForm();
                        const resEl2 = document.getElementById("result");
                        if (resEl2) resEl2.innerHTML = `<p>Scannez un code-barre...</p><div id="test-result"></div>`;
                        const rescan = document.getElementById("rescan-button");
                        if (rescan) rescan.click();
                    }
                });
            } else {
                const failed = actions.filter(a => !a.ok).map(a => a.what).join(", ");
                showToast("error", "Enregistrement partiel", {
                    desc: `Échec sur : ${failed || "opérations multiples"} — voir les logs`
                });
            }
        }
    } catch (e) {
        log("error", "Erreur enregistrement manuel", e.message || e);
        out.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">❌ Erreur : ${e.message || e}</div>`;
        showToast("error", "Erreur réseau", {
            desc: `Impossible d'enregistrer : ${e.message || e}`
        });
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Enregistrer les modifications"; }
    }
}

// ============================
// Boutons (scan uniquement)
// ============================
document.addEventListener("DOMContentLoaded", () => {
    const rescan = document.getElementById("rescan-button");
    if (rescan) rescan.addEventListener("click", () => { rescan.style.display = "none"; startScanner(); });

    const switchBtn = document.getElementById("switch-button");
    if (switchBtn) switchBtn.addEventListener("click", () => {
        currentFacing = (currentFacing === "environment") ? "user" : "environment";
        startScanner();
    });

    const resetBtn = document.getElementById("reset-permissions");
    if (resetBtn) resetBtn.addEventListener("click", async () => {
        try { stopCurrentStream(); await navigator.mediaDevices.getUserMedia({ video: true }); startScanner(); }
        catch (e) { log("error", "Impossible réinit caméra", e.message || e); }
    });

    const toggleLogsBtn = document.getElementById("toggle-logs");
    if (toggleLogsBtn) {
        toggleLogsBtn.addEventListener("click", () => {
            const logs = document.getElementById("logs");
            if (!logs) return;
            const isHidden = logs.offsetParent === null;
            logs.style.display = isHidden ? "block" : "none";
        });
    }

    // v4 : switch de mode (Inventaire / Manuel)
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.addEventListener("click", () => setScanMode(btn.dataset.mode));
    });
    updateScanModeUI();

    // v4 : boutons du formulaire d'édition manuelle via scan
    const manualSaveBtn = document.getElementById("manual-save-btn");
    if (manualSaveBtn) manualSaveBtn.addEventListener("click", saveManualEdit);

    const manualResetBtn = document.getElementById("manual-reset-btn");
    if (manualResetBtn) manualResetBtn.addEventListener("click", () => {
        resetManualForm();
        const resEl = document.getElementById("result");
        if (resEl) resEl.innerHTML = `<p>Scannez un code-barre...</p><div id="test-result"></div>`;
        const rescan = document.getElementById("rescan-button");
        if (rescan && rescan.style.display !== "none") rescan.click();
    });

    if (document.getElementById("video")) startScanner();
});
