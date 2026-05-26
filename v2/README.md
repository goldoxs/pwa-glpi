# PWA GLPI — v2

Version 2 de la PWA d'inventaire GLPI. Autonome et déployable indépendamment de la v1 : tous les fichiers de la v2 résident ici et ne dépendent d'aucun fichier du dossier parent.

## Apports par rapport à la v1

### Fusion des pages manuelles

Les doublons v1 `by_serial_number.html` et `maj_mnauelle.html` (typo) sont remplacés par **une seule page** : `recherche_manuelle.html`.

### Édition de `users_id` (utilisateur associé) et `buy_date`

- Liste des utilisateurs GLPI chargée dynamiquement et filtrée par email (les comptes sans email sont ignorés).
- Le numéro de searchOption pour le champ email est **découvert dynamiquement** via `GET /listSearchOptions/User` (il varie selon la config GLPI).
- Libellé affiché = email ; tri alphabétique.
- Champ `<input type="date">` pour `buy_date`, pré-rempli depuis l'Infocom courant.

### Flux lecture / écriture découplé

La v1 forçait une MAJ de `inventory_date` à chaque recherche. La v2 sépare les deux :

1. **Rechercher** → affichage des infos en lecture seule.
2. Formulaire d'édition pré-rempli : utilisateur, date d'achat, case à cocher "mettre à jour la date d'inventaire".
3. **Enregistrer** → seuls les champs modifiés (ou la case cochée) déclenchent des PUT.

### `glpiFetch` — wrapper avec retry unique sur 401

Toutes les requêtes GLPI passent par `glpiFetch(url, options)`. Si l'API renvoie 401 (session expirée), le token est réinitialisé et la requête rejouée une fois. Élimine les faux "Aucun équipement trouvé" après une longue pause de l'utilisateur.

### Header unifié + favicon + PWA

- Header fixed cohérent sur les 2 pages : logo cliquable à gauche → `index.html`, titre centré, lien externe "Support GLPI" à droite.
- Responsive : titre masqué sous 420 px, label du lien GLPI masqué sous 420 px aussi.
- `<link rel="icon" href="logo_picto.png">` dans tous les HTML.
- `manifest.json` : `logo_picto.png` avec `sizes: any` + `purpose: any/maskable` pour compatibilité Android.

### Tokens externalisés dans `config.js`

`app_multi_v2.js` lit `window.GLPI_CONFIG` (défini par `config.js`, chargé avant le script principal). Permet deux modes de déploiement (voir plus bas).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Scan QR / code-barres (ZXing) |
| `recherche_manuelle.html` | Recherche manuelle + édition `users_id` + `buy_date` + `inventory_date` |
| `app_multi_v2.js` | Session GLPI, `glpiFetch` (401 retry), API, scan |
| `config.js` | `window.GLPI_CONFIG = { URL, APP_TOKEN, USER_TOKEN }` |
| `config.template.js` | Template avec `${VARS}` pour injection runtime via `envsubst` |
| `docker-entrypoint.sh` | Entrypoint : génère `config.js` depuis les env vars |
| `Dockerfile` | Image simple (tokens bakés dans l'image via `config.js`) |
| `Dockerfile.prod` | Image prod (tokens injectés au démarrage) |
| `style.css` | Styles globaux + header, palette `#007bff` |
| `manifest.json` | Manifest PWA |
| `sw.js` | Service worker (cache + fetch strategy) |
| `logo.png`, `logo_picto.png` | Logo complet + pictogramme carré |

## Personnalisation

La v2 n'a pas encore de `branding.js` séparé (introduit en v3) — certaines valeurs restent donc à modifier directement dans le HTML.

| Quoi | Où |
|---|---|
| **Tokens GLPI** | `config.js` — 3 champs (URL, APP_TOKEN, USER_TOKEN) |
| **Logo complet** | Remplacer `logo.png` (utilisé comme `apple-touch-icon`) |
| **Pictogramme carré** | Remplacer `logo_picto.png` (favicon + header + icône PWA) |
| **URL "Support GLPI"** | En dur dans `index.html` et `recherche_manuelle.html` (balise `<a class="app-header__glpi" href="...">`) |
| **Texte header** | "Solution d'inventaire" en dur dans le header des deux HTML (`<span class="app-header__logo-text">`) |

## Endpoints GLPI utilisés

- `GET  /initSession` — session token (relancé automatiquement sur 401)
- `GET  /search/{TYPE}?criteria[0][field]=5&...` — recherche par numéro de série
- `GET  /{TYPE}/{ID}` — item complet (incluant `users_id`)
- `GET  /{TYPE}/{ID}/Infocom/` — infocom associé (id, `buy_date`, `inventory_date`)
- `GET  /listSearchOptions/User` — découverte du numéro de champ email
- `GET  /search/User?range=0-500&forcedisplay[...]` — liste des utilisateurs
- `PUT  /{TYPE}/{ID}` — `{ input: { id, users_id } }`
- `PUT  /Infocom/{INFOCOM_ID}` — `{ input: { id, inventory_date?, buy_date? } }`

Types supportés : `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`.

## Déploiement

### Local (dev)

```bash
npx http-server . -p 8085   # servir en HTTP (localhost autorisé par les navigateurs)
```

`config.js` est déjà rempli avec les placeholders `XXX_*_XXX` — à remplacer par vos tokens pour tester.

### Docker — option simple (tokens bakés dans l'image)

Éditer `config.js` avec vos tokens, puis :

```bash
docker build -t pwa-glpi:v2 .
docker run -p 8085:80 pwa-glpi:v2
```

Simple mais l'image contient les tokens en clair → à réserver aux déploiements internes.

### Docker — option prod recommandée (tokens injectés au runtime)

```bash
docker build -t pwa-glpi:v2 -f Dockerfile.prod .
docker run -p 8085:80 \
  -e GLPI_URL=https://your-glpi.example.com/apirest.php/ \
  -e GLPI_APP_TOKEN=xxx \
  -e GLPI_USER_TOKEN=yyy \
  pwa-glpi:v2
```

`docker-entrypoint.sh` exécute `envsubst` sur `config.template.js` pour générer `config.js` au démarrage. Les tokens ne sont ni dans l'image, ni dans le code versionné.

## Migration v1 → v2

| v1 | v2 |
|---|---|
| `app_multi.js` | `app_multi_v2.js` (compatible, plus le wrapper `glpiFetch`) |
| `by_serial_number.html` + `maj_mnauelle.html` | `recherche_manuelle.html` (page unique, formulaire enrichi) |
| Tokens dans `app_multi.js` | Tokens dans `config.js` (facile à externaliser) |
| Cache SW `inventory-app-cache-v4` | Cache SW `inventory-app-cache-v5-v2-p0-fixes` (+ `skipWaiting`/`claim`) |

Pensez à bumper le nom du cache dans `sw.js` après chaque modification du bundle servi, sinon les anciens clients gardent la version cachée.

## Prérequis GLPI

- Utilisateur technique avec droits :
  - `read/write` sur `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`
  - `read/write` sur `Infocom`
  - `read` sur `User` (pour `/search/User` et `/listSearchOptions/User`)
- App-Token + User-Token créés dans GLPI → Configuration → Général → API.
