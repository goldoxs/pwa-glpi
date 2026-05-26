// ============================
// Configuration GLPI — PWA-GLPI v2
// ----------------------------
// /!\ Ce fichier contient des tokens d'API. Il est servi par nginx au navigateur
//     → quiconque atteint l'URL de la PWA peut les récupérer.
//
// Avant un déploiement exposé à l'Internet public, ce fichier doit être
// régénéré à partir de variables d'environnement (ex: via `envsubst` au
// lancement du conteneur Docker) ou remplacé par un proxy backend qui signe
// les requêtes GLPI côté serveur.
//
// Un exemple de template `config.template.js` + entrypoint Docker est
// documenté dans le README.
// ============================
window.GLPI_CONFIG = {
    URL: "https://your-glpi.example.com/apirest.php/", // <-- URL d'acces au GLPI
    APP_TOKEN: "XXX_APP_TOKEN_XXX", // <-- Mettre le token API de l'application GLPI
    USER_TOKEN: "XXX_USER_TOKEN_XXX" // <-- Mettre le token API de l'utilisateur
};
