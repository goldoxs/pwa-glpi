// ============================================================
// PERSONNALISATION — Éléments visuels (non sensibles)
// ============================================================
// Modifiez ce fichier pour adapter la PWA à votre identité :
//   • Nom affiché dans le header
//   • Chemin du logo et du pictogramme
//   • URL d'ouverture du bouton "Support GLPI"
//
// Pour les couleurs     → éditer style.css (section PERSONNALISATION)
// Pour les tokens GLPI  → éditer config.js
// ============================================================
window.APP_BRANDING = {
    // Texte affiché à côté du pictogramme dans le header (visible ≥ 640 px)
    APP_NAME:     "Solution d'inventaire",

    // Pictogramme carré (header + favicon + icône PWA)
    PICTO_SRC:    "logo_picto.png",

    // Logo complet (apple-touch-icon sur iOS)
    LOGO_SRC:     "logo.png",

    // URL ouverte par le bouton "Support GLPI" (en haut à droite du header)
    GLPI_APP_URL: "https://your-glpi.example.com/"
};

// ---------- Application automatique du branding ----------
// Ne pas modifier ci-dessous (sauf besoin spécifique).
window.applyBranding = function () {
    var b = window.APP_BRANDING || {};
    if (b.PICTO_SRC) {
        var fav = document.querySelector('link[rel="icon"]');
        if (fav) fav.href = b.PICTO_SRC;
    }
    if (b.LOGO_SRC) {
        var apple = document.querySelector('link[rel="apple-touch-icon"]');
        if (apple) apple.href = b.LOGO_SRC;
    }
    document.querySelectorAll('[data-branding="picto"]').forEach(function (e) {
        if (b.PICTO_SRC) e.src = b.PICTO_SRC;
    });
    document.querySelectorAll('[data-branding="app-name"]').forEach(function (e) {
        if (b.APP_NAME) e.textContent = b.APP_NAME;
    });
    document.querySelectorAll('[data-branding="glpi-url"]').forEach(function (e) {
        if (b.GLPI_APP_URL) e.href = b.GLPI_APP_URL;
    });
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.applyBranding);
} else {
    window.applyBranding();
}
