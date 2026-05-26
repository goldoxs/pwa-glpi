# PWA GLPI — v3

Application d'inventaire physique GLPI. Version 3 — refonte graphique complète de la v2 : palette CSS centralisée, `branding.js` séparé pour le rebranding sans toucher au code, **tokens GLPI jamais présents dans le code ni dans l'image Docker** (injectés au démarrage du conteneur via variables d'environnement ou Docker Swarm secrets).

---

## Personnalisation (forker / rebrander)

Trois zones clairement séparées :

| Quoi                                    | Où                                       | Comment                                                          |
|-----------------------------------------|------------------------------------------|------------------------------------------------------------------|
| **Couleurs**                            | `style.css`                              | 3 variables CSS `--brand-*` en tête de fichier                   |
| **Logo, picto, nom, URL Support GLPI**  | `branding.js`                            | 4 champs dans `window.APP_BRANDING`                              |
| **Tokens API GLPI**                     | Variables d'environnement / Swarm secrets | Injectés à l'exécution par `docker-entrypoint.sh` — **jamais en dur dans le code** |

### Couleurs — 3 lignes

En tête de `style.css`, bloc `:root` :

```css
--brand-primary:   #272758;   /* Principale : header, boutons primary */
--brand-accent:    #2eabe2;   /* Accent clair : focus, liens, info    */
--brand-highlight: #F68B1F;   /* Accent vif : CTA forts, warnings     */
```

Les couleurs dérivées (hover, fonds doux, variantes "dark" pour le texte AA) sont listées juste en dessous et peuvent être ajustées si nécessaire. Tous les couples texte/fond actuels respectent **WCAG AA** (≥ 4.5:1).

### Logo, picto, nom, URL GLPI — `branding.js`

```js
window.APP_BRANDING = {
    APP_NAME:     "Solution d'inventaire",           // Texte du header (desktop)
    PICTO_SRC:    "logo_picto.png",                  // Picto carré (header + favicon + icône PWA)
    LOGO_SRC:     "logo.png",                        // Logo complet (apple-touch-icon)
    GLPI_APP_URL: "https://your-glpi.example.com/"   // URL du bouton "Support GLPI"
};
```

`branding.js` est chargé dans `<head>` et applique automatiquement les valeurs au chargement de la page. Les éléments HTML concernés sont marqués avec `data-branding="picto"`, `data-branding="app-name"`, `data-branding="glpi-url"`. Aucune modification du HTML n'est nécessaire — changez seulement `branding.js`.

Remplacez `logo_picto.png` (150×150 px, carré, format PNG) et `logo.png` (logo horizontal complet) par vos propres fichiers. Si vous gardez les mêmes noms, aucune modification de `branding.js` n'est nécessaire. Si vous changez la taille du picto, mettez à jour `manifest.json` en conséquence (champ `sizes` sur les 2 entrées `icons`).

### Tokens API GLPI — runtime uniquement

Le `config.js` qui définit `window.GLPI_CONFIG` est **généré au démarrage du conteneur** à partir de `config.template.js` et des variables d'environnement (ou des fichiers `/run/secrets/*` si vous utilisez Docker Swarm secrets).

→ Aucun token n'est présent dans le code source, ni dans l'image Docker construite.
→ Rien à éditer avant le build.
→ Les 3 valeurs sont fournies uniquement au `docker run` (ou par le Swarm).

---

## Fichiers

| Fichier                    | Rôle                                                                   |
|----------------------------|------------------------------------------------------------------------|
| `index.html`               | Page scan QR (ZXing)                                                   |
| `recherche_manuelle.html`  | Formulaire recherche + édition (`users_id` par email, `buy_date`)      |
| `app_multi_v2.js`          | Logique métier : session GLPI, `glpiFetch` (retry 401), API            |
| `branding.js`              | **Personnalisation** (nom, logo, picto, URL GLPI)                      |
| `config.template.js`       | Template (placeholders `${...}`) — rempli au runtime par l'entrypoint  |
| `docker-entrypoint.sh`     | Génère `config.js` depuis l'env ou les Swarm secrets, puis lance nginx |
| `Dockerfile.prod`          | Image de production, tokens injectés au démarrage                      |
| `docker-compose.yml`       | Compose simple pour `docker compose up` (1 hôte, valeurs dans `.env`)  |
| `docker-compose.prod.yml`  | Stack Docker Swarm avec secrets chiffrés + Traefik                     |
| `.env.example`             | Template des 3 variables GLPI_* (copier en `.env`)                     |
| `style.css`                | **Personnalisation** (3 couleurs de marque en tête) + thème complet    |
| `manifest.json`            | Manifest PWA                                                           |
| `sw.js`                    | Service worker, cache `inventory-app-cache-v6-v3-branding-mobile-fix`  |
| `logo.png`, `logo_picto.png` | Ressources graphiques                                                |

---

## Structure `data-branding`

`branding.js` applique automatiquement les valeurs de `window.APP_BRANDING` aux éléments du DOM marqués :

| Attribut                                    | Effet                                         |
|---------------------------------------------|-----------------------------------------------|
| `data-branding="picto"` (sur `<img>`)       | `.src = APP_BRANDING.PICTO_SRC`               |
| `data-branding="app-name"` (tout élément)   | `.textContent = APP_BRANDING.APP_NAME`        |
| `data-branding="glpi-url"` (sur `<a>`)      | `.href = APP_BRANDING.GLPI_APP_URL`           |
| `<link rel="icon">`                         | `.href = APP_BRANDING.PICTO_SRC`              |
| `<link rel="apple-touch-icon">`             | `.href = APP_BRANDING.LOGO_SRC`               |

Ajoutez ces attributs à d'autres éléments si votre personnalisation le demande — `branding.js` les détectera automatiquement.

---

## Déploiement

### Option A — `docker run` avec env vars (test rapide, 1 hôte)

```bash
docker build -t pwa-glpi:v3-prod -f Dockerfile.prod .
docker run -p 8085:80 \
  -e GLPI_URL=https://your-glpi.example.com/apirest.php/ \
  -e GLPI_APP_TOKEN=xxx \
  -e GLPI_USER_TOKEN=yyy \
  pwa-glpi:v3-prod
```

Puis ouvrir `http://localhost:8085`.

Au démarrage, `docker-entrypoint.sh` :
1. Lit les 3 valeurs depuis les variables d'environnement
2. Exécute `envsubst` sur `config.template.js` pour produire `config.js`
3. Lance nginx

Si une des 3 variables est absente, l'entrypoint échoue **avant** le démarrage de nginx avec un message explicite — pas de fallback silencieux.

### Option B — `docker compose up` (1 hôte, `.env` pour les secrets)

```bash
cp .env.example .env
# Éditer .env avec vos valeurs (fichier git-ignoré)
docker compose up -d --build
```

Le `docker-compose.yml` :
- Build l'image depuis `Dockerfile.prod` (ou la réutilise si déjà buildée)
- Injecte `GLPI_URL`, `GLPI_APP_TOKEN`, `GLPI_USER_TOKEN` depuis `.env`
- Expose le port 8085, avec healthcheck et `restart: unless-stopped`

Équivalent fonctionnel à l'Option A, mais plus propre pour itérer (pas de ligne de commande à rallonge, secrets hors du shell history).

### Option C — Docker Swarm secrets (prod multi-nœuds)

Créez 3 secrets Swarm sur le manager :

```bash
printf 'https://your-glpi.example.com/apirest.php/' | docker secret create pwa_glpi_api_url -
printf 'your-app-token'  | docker secret create pwa_glpi_app_token -
printf 'your-user-token' | docker secret create pwa_glpi_user_token -
```

Puis déployez avec le compose fourni (remplacez `your-registry.example.com/pwa-glpi:v3-prod` par votre image poussée sur votre registry) :

```bash
docker stack deploy -c docker-compose.prod.yml pwa-glpi
```

`docker-entrypoint.sh` détecte les fichiers dans `/run/secrets/` et leur donne priorité sur les variables d'environnement. Les secrets Swarm sont chiffrés dans le Raft log, montés en `tmpfs` dans le conteneur (jamais sur le disque hôte) et invisibles dans `docker inspect`.

### Rotation des tokens

Les secrets Docker Swarm sont immuables. Pour faire tourner un token :

```bash
# 1. Créer le nouveau secret avec un suffixe
printf 'nouveau-token' | docker secret create pwa_glpi_app_token_v2 -

# 2. Mettre à jour le compose pour pointer sur le nouveau secret, puis redeploy
docker stack deploy -c docker-compose.prod.yml pwa-glpi

# 3. Une fois validé, supprimer l'ancien
docker secret rm pwa_glpi_app_token
```

---

## Différences v2 → v3

- **Palette centralisée** dans `style.css` (variables `--brand-*`) — 3 lignes à changer pour rebrander.
- **`branding.js` séparé** — nom, logo, picto, URL GLPI modifiables sans toucher au HTML.
- **Tokens jamais dans le code ni l'image** — uniquement au runtime via env vars ou Swarm secrets.
- **Refonte CSS complète** : tokens d'espacement, radius, typographie ; composants `.btn`, `.result`, `.scanner`, `.logs`, `.badge`, `.card`...
- HTML refactorisé autour de `<main class="app-main">` et de composants thème.
- **Aucune modification de `app_multi_v2.js`** — tous les IDs HTML sont préservés → compatibilité fonctionnelle 100%.
- Header mobile : pastille "Support GLPI" en mode icon-only sous 640 px (fix du débordement en v2).
- Compose Swarm d'exemple (`docker-compose.prod.yml`) avec Traefik + healthcheck + rollback automatique.
- Cache service worker : `inventory-app-cache-v6-v3-branding-mobile-fix`.

---

## Prérequis GLPI

- Utilisateur technique avec droits :
  - `read/write` sur `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`
  - `read/write` sur `Infocom`
  - `read` sur `User` (pour `/search/User` et `/listSearchOptions/User`)
- App-Token + User-Token créés dans GLPI → Configuration → Général → API.
