// ============================
// Configuration GLPI (token fixe ici)
// ============================
const GLPI_CONFIG = {
    URL: "https://your-glpi.example.com/apirest.php/", // <-- URL d'acces au GLPI
    APP_TOKEN: "XXX_APP_TOKEN_XXX", // <-- Mettre le token API de l'application GLPI
    USER_TOKEN: "XXX_USER_TOKEN_XXX" // <-- Mettre le token API de l'utilisateur
};

let sessionToken = null;
let codeReader = null;
let currentFacing = "environment"; // arrière par défaut
window._activeStream = null;

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

function formatDateForGLPI(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

// ============================
// Recherche & update Infocom
// ============================
async function searchAndUpdate(serialNumber, equipmentType, headers) {
    const url =
        `${GLPI_CONFIG.URL}search/${equipmentType}?range=0-99` +
        `&criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]=${encodeURIComponent(serialNumber)}` +
        `&forcedisplay[0]=1&forcedisplay[1]=2&forcedisplay[2]=5&forcedisplay[3]=125&forcedisplay[4]=7`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.data || data.data.length === 0) return false;

    const item = data.data[0];
    const itemId = item[2] || item["2"];
    const itemName = item[1] || item["1"] || "—";
    const lastInv = item[125] || item["125"] || null;
    const contact = item[7] || item["7"] || "Non renseigné";

    log("success", `${equipmentType} trouvé`, { id: itemId, name: itemName, contact, dernierInventaire: lastInv });

    // affichage
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

    await updateInfocomDate(equipmentType, itemId, headers);
    return true;
}

async function updateInfocomDate(equipmentType, itemId, headers) {
    log("info", `Mise à jour Infocom pour ${equipmentType} ${itemId}`);

    let infocomId = null;

    // Étape 1 : accès direct via relation /{Type}/{id}/Infocom/
    try {
        const relationUrl = `${GLPI_CONFIG.URL}${equipmentType}/${itemId}/Infocom/`;
        const relationResp = await fetch(relationUrl, { headers });
        if (relationResp.ok) {
            const relationData = await relationResp.json();
            if (Array.isArray(relationData) && relationData.length > 0) {
                infocomId = relationData[0].id;
            } else if (relationData.id) {
                infocomId = relationData.id;
            }
        }
    } catch (e) {
        log("warning", "Erreur accès direct Infocom", e);
    }

    if (!infocomId) {
        log("warning", `Pas d'Infocom trouvé pour ${equipmentType} ${itemId}`);
        return;
    }

    // Étape 2 : Mise à jour de la date
    const infocomUrl = `${GLPI_CONFIG.URL}Infocom/${infocomId}`;
    const today = formatDateForGLPI();
    const updateData = { input: { id: parseInt(infocomId), inventory_date: today } };

    const updateResp = await fetch(infocomUrl, {
        method: "PUT",
        headers,
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
// Caméra
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
    if (!sessionToken) await initGLPISession();
    const headers = getAuthHeaders();
    const types = ["Computer", "Monitor", "Peripheral", "NetworkEquipment", "Phone"];
    let found = false;
    for (const t of types) {
        const ok = await searchAndUpdate(serialNumber, t, headers);
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
    // if (!found) log("warning", `Aucun équipement trouvé pour ${serialNumber}`);
}

// ============================
// Boutons
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

            // Vérifie si l'élément est actuellement masqué
            const isHidden = logs.offsetParent === null;

            // Alterne entre affiché / masqué
            logs.style.display = isHidden ? "block" : "none";
        });
    }
    if (document.getElementById("video")) startScanner();
});
