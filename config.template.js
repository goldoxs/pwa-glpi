// Template pour config.js — les placeholders ${...} sont remplacés au démarrage
// du conteneur Docker par `envsubst` via docker-entrypoint.sh.
// Voir Dockerfile.prod et docker-entrypoint.sh dans ce dossier.
window.GLPI_CONFIG = {
    URL:        "${GLPI_URL}",
    APP_TOKEN:  "${GLPI_APP_TOKEN}",
    USER_TOKEN: "${GLPI_USER_TOKEN}"
};
