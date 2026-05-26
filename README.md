# PWA GLPI — Inventory scanner

Progressive Web App pour l'inventaire physique GLPI. Scannez un QR Code sur un équipement avec votre téléphone et la date d'inventaire du matériel correspondant dans GLPI est automatiquement mise à jour (champ `inventory_date` de la relation Infocom). Fonctionne en HTTPS depuis n'importe quel navigateur mobile récent, installable en PWA, avec un cache offline pour le shell de l'application.

Ce dépôt contient **4 versions** progressivement enrichies, conservées comme étapes de référence pour permettre à n'importe qui de reprendre la base la plus adaptée à son contexte.

## Les 4 versions

| Version | Description | Tokens | UI |
|---|---|---|---|
| [**v1**](v1/) | MVP — scan QR + update `inventory_date`. Doublons de pages historiques conservés (`by_serial_number.html`, `maj_mnauelle.html`). | En clair dans `app_multi.js` | Simple (Bootstrap-like manuel) |
| [**v2**](v2/) | Fusion des pages en `recherche_manuelle.html`. Édition `users_id` (par email) et `buy_date`. Wrapper `glpiFetch` avec retry 401. Favicon, header unifié. Tokens externalisés dans `config.js`. | `config.js` (dev) ou envsubst + env vars (prod) | Header fixe + palette `#007bff` |
| [**v3**](v3/) | Refonte graphique complète (palette violet/cyan/orange). `branding.js` séparé pour le rebranding sans toucher au HTML. Support Docker Swarm secrets. Design mobile-first WCAG AA. | **Runtime uniquement** — env vars ou Swarm secrets. Jamais dans le code ni dans l'image. | Refonte complète, CSS variables centralisées |
| [**v4**](v4/) | v3 + **switch Inventaire / Manuel** sur la page Scan QR (mode Manuel = le scan ouvre le formulaire d'édition). **Toast** de confirmation après chaque écriture (succès 5 s + auto-rescan, échec sticky). **Export des logs** en `.txt` + persistance localStorage. | **Runtime uniquement** — identique v3 | v3 + switch + toast modal |

Les versions sont indépendantes — choisissez celle qui correspond à votre niveau de besoin et dupliquez uniquement le dossier correspondant.

## Quick start (v4 recommandée)

```bash
git clone https://github.com/your-org/pwa-glpi.git
cd pwa-glpi/v4

# 1. Customiser branding.js (nom, logo, picto, URL GLPI)
# 2. (Optionnel) Customiser style.css — 3 variables --brand-* en tête de fichier
```

Ensuite, **3 façons de déployer** — au choix, selon votre environnement. Les 3 donnent le même résultat côté conteneur : un `config.js` généré au démarrage à partir du template et de vos valeurs.

### Option A — `docker run` (le plus simple, 1 hôte)

```bash
docker build -t pwa-glpi:v4-prod -f Dockerfile.prod .
docker run -p 8085:80 \
  -e GLPI_URL=https://your-glpi.example.com/apirest.php/ \
  -e GLPI_APP_TOKEN=xxx \
  -e GLPI_USER_TOKEN=yyy \
  pwa-glpi:v4-prod
```

### Option B — `docker compose up` (recommandé en dev/staging sur 1 hôte)

Les valeurs sensibles sont rangées dans un `.env` (git-ignoré), plus propre que la CLI.

```bash
cp .env.example .env         # puis éditer .env avec vos 3 valeurs de token API et d'url GLPI
docker compose up -d --build
```

Le fichier [`docker-compose.yml`](v4/docker-compose.yml) construit l'image depuis `Dockerfile.prod` et injecte les 3 variables depuis `.env`. Healthcheck + `restart: unless-stopped` inclus.

### Option C — `docker stack deploy` sur Docker Swarm (recommandé en prod multi-nœuds)

Tokens stockés comme **Docker Swarm secrets**.

```bash
# One-time : créer les 3 secrets
printf 'https://your-glpi.example.com/apirest.php/' | docker secret create pwa_glpi_api_url -
printf 'your-app-token'  | docker secret create pwa_glpi_app_token -
printf 'your-user-token' | docker secret create pwa_glpi_user_token -

# Déployer la stack avec Traefik, healthcheck, rollback auto
docker stack deploy -c docker-compose.prod.yml pwa-glpi
```

Le compose [`docker-compose.prod.yml`](v4/docker-compose.prod.yml) inclut les labels Traefik (routing HTTP + TLS via `traefik-public`), la politique de rolling update (`start-first`) et le rollback automatique en cas d'échec du healthcheck.

Pour v1, v2 et v3, voir leur README respectif — mêmes principes, moins de features.

## Customisation — récapitulatif

| Élément | v1 | v2 | v3 | v4 |
|---|---|---|---|---|
| **URL GLPI + tokens** | `app_multi.js` (bloc `GLPI_CONFIG` en tête) | `config.js` ou env vars via `Dockerfile.prod` | **Env vars ou Swarm secrets via `Dockerfile.prod`** (jamais en dur) | Identique v3 |
| **Logo complet** | `logo.png` (~200 px de large) | `logo.png` (apple-touch-icon) | `logo.png`, chemin défini dans `branding.js` | Identique v3 |
| **Pictogramme carré** | — | `logo_picto.png` (favicon + icône PWA, `sizes: any`) | `logo_picto.png` (150×150 px idéalement), chemin dans `branding.js` | Identique v3 |
| **Couleurs** | En dur dans `style.css` et chaque HTML (palette `#007bff`) | En dur dans `style.css` (palette `#007bff`) | 3 variables CSS `--brand-*` en tête de `style.css` | Identique v3 |
| **URL "Support GLPI"** | En dur dans le HTML de chaque page | En dur dans le header de chaque HTML | Champ `GLPI_APP_URL` dans `branding.js` | Identique v3 |
| **Nom de l'app affiché** | En dur dans les `<h1>` | En dur dans `<span class="app-header__logo-text">` | Champ `APP_NAME` dans `branding.js` | Identique v3 |
| **Délai toast** | — | — | — | `TOAST_AUTO_CLOSE_MS` en tête de `app_multi_v2.js` (défaut 5 s) |

## Prérequis GLPI

Côté GLPI, vous devez :

1. **Activer l'API REST** : Configuration → Général → API → "Enable Rest API" + "Enable login with external token".
2. **Créer un App-Token** : Configuration → Général → API → "Add API client" → noter l'App-Token généré.
3. **Créer un utilisateur technique** : un compte dédié à la PWA, avec un User-Token (Préférences de cet utilisateur → "Remote access keys").
4. **Droits sur le profil** de cet utilisateur :
   - `read` sur `User` (pour `/search/User` — nécessaire en v2/v3 pour la liste déroulante)
   - `read/write` sur `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`
   - `read/write` sur `Infocom`
5. **CORS** : si la PWA est servie depuis un domaine différent de GLPI, configurez les en-têtes CORS côté GLPI ou via un reverse proxy.

## Contributing

Issues et pull requests bienvenus. Merci de préciser dans l'issue / la PR la version concernée (v1, v2, v3 ou v4) — les 4 cohabitent et sont maintenues en l'état pour préserver la lisibilité de l'évolution.

## License

Distribué sous licence [MIT](LICENSE). Remplacez `Your Name` par votre nom / votre organisation lors du fork.
