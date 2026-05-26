#!/bin/sh
set -eu

# Injecte les tokens GLPI dans config.js au démarrage du conteneur.
# Source des tokens (dans cet ordre de priorité) :
#   1. Fichiers secrets Docker Swarm dans /run/secrets/*  (recommandé)
#   2. Variables d'environnement GLPI_*                    (fallback simple)
#
# Noms attendus :
#   /run/secrets/glpi_url        ou  env GLPI_URL
#   /run/secrets/glpi_app_token  ou  env GLPI_APP_TOKEN
#   /run/secrets/glpi_user_token ou  env GLPI_USER_TOKEN

# 1. Lecture depuis les secrets Swarm (priorité)
if [ -f /run/secrets/glpi_url ]; then
    GLPI_URL=$(cat /run/secrets/glpi_url)
fi
if [ -f /run/secrets/glpi_app_token ]; then
    GLPI_APP_TOKEN=$(cat /run/secrets/glpi_app_token)
fi
if [ -f /run/secrets/glpi_user_token ]; then
    GLPI_USER_TOKEN=$(cat /run/secrets/glpi_user_token)
fi

# 2. Validation — échec rapide si manquant
: "${GLPI_URL:?GLPI_URL non défini (env var ou /run/secrets/glpi_url)}"
: "${GLPI_APP_TOKEN:?GLPI_APP_TOKEN non défini (env var ou /run/secrets/glpi_app_token)}"
: "${GLPI_USER_TOKEN:?GLPI_USER_TOKEN non défini (env var ou /run/secrets/glpi_user_token)}"

export GLPI_URL GLPI_APP_TOKEN GLPI_USER_TOKEN

TEMPLATE=/usr/share/nginx/html/config.template.js
TARGET=/usr/share/nginx/html/config.js

envsubst '${GLPI_URL} ${GLPI_APP_TOKEN} ${GLPI_USER_TOKEN}' < "$TEMPLATE" > "$TARGET"
echo "[entrypoint] config.js généré depuis $TEMPLATE"

exec "$@"
