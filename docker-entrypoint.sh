#!/bin/sh
set -eu

# Injecte les tokens GLPI depuis l'environnement dans config.js au démarrage.
# Permet d'éviter de baker les tokens dans l'image Docker.
#
# Variables requises :
#   GLPI_URL         ex: https://your-glpi.example.com/apirest.php/
#   GLPI_APP_TOKEN
#   GLPI_USER_TOKEN

: "${GLPI_URL:?GLPI_URL non défini}"
: "${GLPI_APP_TOKEN:?GLPI_APP_TOKEN non défini}"
: "${GLPI_USER_TOKEN:?GLPI_USER_TOKEN non défini}"

TEMPLATE=/usr/share/nginx/html/config.template.js
TARGET=/usr/share/nginx/html/config.js

envsubst '${GLPI_URL} ${GLPI_APP_TOKEN} ${GLPI_USER_TOKEN}' < "$TEMPLATE" > "$TARGET"
echo "[entrypoint] config.js généré depuis le template"

exec "$@"
