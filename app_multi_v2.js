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
// Logging
// ============================
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (data) console.log(entry, data); else console.log(entry);

    const logsEl = getLogsElement();
    if (!logsEl) return;
    const d = document.createElement("div");
    d.className = `log-${level}`;
    d.textContent = entry;
    if (data) d.textContent += "\n" + JSON.stringify(data, null, 2);
    logsEl.appendChild(d);
    logsEl.scrollTop = logsEl.scrollHeight;
}

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
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.data || data.data.length === 0) return false;

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

    await updateInfocomDate(equipmentType, itemId);
    return true;
}

async function updateInfocomDate(equipmentType, itemId) {
    log("info", `Mise à jour Infocom pour ${equipmentType} ${itemId}`);
    const infocom = await getInfocom(equipmentType, itemId);
    if (!infocom || !infocom.id) {
        log("warning", `Pas d'Infocom trouvé pour ${equipmentType} ${itemId}`);
        return;
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
    } else {
        const errorText = await updateResp.text();
        log("error", `Échec mise à jour Infocom pour ${equipmentType} ${itemId}: ${errorText}`);
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
    const types = ["Computer", "Monitor", "Peripheral", "NetworkEquipment", "Phone"];
    let found = false;
    for (const t of types) {
        const ok = await searchAndUpdate(serialNumber, t);
        if (ok) { found = true; break; }
    }
    const out = document.getElementById("test-result");
    out.innerHTML = "";
    if (found) {
        out.innerHTML = `<div style="background:#d4edda;color:#155724;padding:10px;border-radius:5px;">
            ✅ Inventaire mis à jour pour ${serialNumber}
        </div>`;
    } else {
        out.innerHTML = `<div style="background:#f8d7da;color:#721c24;padding:10px;border-radius:5px;">
            ❌ Aucun équipement trouvé pour ${serialNumber}
        </div>`;
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
    if (document.getElementById("video")) startScanner();
});
