# PWA GLPI — v4

Application d'inventaire physique GLPI. Version 4 — v3 + **double mode sur la page Scan QR** (Inventaire / Manuel via QR) + **toast de confirmation** après chaque opération d'écriture + **export des logs** en fichier `.txt`. Tokens GLPI jamais présents dans le code ni dans l'image Docker (injectés au démarrage du conteneur via variables d'environnement ou Docker Swarm secrets).

---

## Nouveautés v4

### Page Scan QR — deux modes

Un switch `Inventaire / Manuel` apparaît au-dessus du scanner. Le choix est persisté en `localStorage`, donc chaque utilisateur retrouve son mode préféré au retour.

- **Inventaire** (par défaut — comportement v1/v2/v3) : scan QR = MAJ automatique de la `inventory_date` dans GLPI. Workflow rapide pour un tour d'inventaire.
- **Manuel** (nouveau) : scan QR = ouverture du **formulaire d'édition pré-rempli** avec l'utilisateur assigné, la date d'achat (`buy_date` sur Infocom) et une case à cocher pour la date d'inventaire. Même formulaire que `recherche_manuelle.html` mais alimenté par le scan au lieu d'un numéro saisi. Après enregistrement, les infos sont rafraîchies depuis GLPI et le formulaire reste ouvert pour retouche.

### Toast de confirmation (v4.1)

Après chaque écriture (scan en Inventaire, Enregistrer en Manuel ou sur `recherche_manuelle.html`), une pop-up modale s'affiche en bas de l'écran :

- **Succès** (vert) : toast 5 s avec barre de progression → auto-close + auto-rescan (ou clear + focus sur le champ série en recherche manuelle).
- **Échec** (rouge) : toast sticky avec bouton *Fermer* — reste jusqu'à action utilisateur.

Plus besoin d'ouvrir le panneau de logs pour savoir si la MAJ a fonctionné. Délai ajustable via la constante `TOAST_AUTO_CLOSE_MS` en tête de `app_multi_v2.js`.

### Export des logs (v4.1)

- Buffer en mémoire **500 entrées max** miroiré dans `localStorage` (persistance inter-sessions).
- Nouveau bouton **« Télécharger les logs »** sur les 2 pages : génère un fichier `.txt` téléchargeable avec header (timestamp, user-agent, URL, count) + toutes les entrées formatées.
- Bouton **« Effacer les logs »** purge désormais aussi le buffer + le `localStorage` (pas seulement le DOM).

---

## Personnalisation (forker / rebrander)

Trois zones clairement séparées :

| Quoi                                    | Où                                        | Comment                                                          |
|-----------------------------------------|-------------------------------------------|------------------------------------------------------------------|
| **Couleurs**                            | `style.css`                               | 3 variables CSS `--brand-*` en tête de fichier                   |
| **Logo, picto, nom, URL Support GLPI**  | `branding.js`                             | 4 champs dans `window.APP_BRANDING`                              |
| **Tokens API GLPI**                     | Variables d'environnement / Swarm secrets | Injectés à l'exécution par `docker-entrypoint.sh` — **jamais en dur dans le code** |

### Couleurs — 3 lignes

En tête de `style.css`, bloc `:root` :

```css
--brand-primary:   #272758;   /* Principale : header, boutons primary, switch actif */
--brand-accent:    #2eabe2;   /* Accent clair : focus, liens, info                   */
--brand-highlight: #F68B1F;   /* Accent vif : CTA forts (Enregistrer)                */
```

Les couleurs dérivées (hover, fonds doux, variantes "dark" pour le texte AA) sont listées juste en dessous et peuvent être ajustées si nécessaire. Tous les couples texte/fond actuels respectent **WCAG AA** (≥ 4.5:1).

### Logo, picto, nom, URL GLPI — `branding.js`

```js
window.APP_BRANDING = {
    APP_NAME:     "Solution d'inventaire",            // Texte du header (desktop)
    PICTO_SRC:    "logo_picto.png",                   // Picto carré (header + favicon + icône PWA)
    LOGO_SRC:     "logo.png",                         // Logo complet (apple-touch-icon)
    GLPI_APP_URL: "https://your-glpi.example.com/"    // URL du bouton "Support GLPI"
};
```

`branding.js` est chargé dans `<head>` et applique automatiquement les valeurs au chargement de la page via les attributs `data-branding="picto|app-name|glpi-url"`. Aucune modification du HTML n'est nécessaire — changez seulement `branding.js`.

Remplacez `logo_picto.png` (150×150 px, carré, PNG) et `logo.png` par vos propres fichiers. Si vous gardez les mêmes noms, aucune modification de `branding.js` n'est nécessaire. Si vous changez la taille du picto, mettez à jour `manifest.json` en conséquence.

### Tokens API GLPI — runtime uniquement

Le `config.js` qui définit `window.GLPI_CONFIG` est **généré au démarrage du conteneur** à partir de `config.template.js` et des variables d'environnement (ou des fichiers `/run/secrets/*` si vous utilisez Docker Swarm secrets).

→ Aucun token n'est présent dans le code source, ni dans l'image Docker construite.
→ Rien à éditer avant le build.
→ Les 3 valeurs sont fournies uniquement au `docker run` (ou par le Swarm).

---

## Fichiers

| Fichier                    | Rôle                                                                      |
|----------------------------|---------------------------------------------------------------------------|
| `index.html`               | Page scan QR — **switch Inventaire / Manuel** + formulaire d'édition      |
| `recherche_manuelle.html`  | Recherche par numéro de série (fallback hors-scan)                        |
| `app_multi_v2.js`          | Logique métier : session GLPI, `glpiFetch` (401 retry), toast, log buffer |
| `branding.js`              | **Personnalisation** (nom, logo, picto, URL GLPI)                         |
| `config.template.js`       | Template (placeholders `${...}`) rempli au runtime par l'entrypoint       |
| `docker-entrypoint.sh`     | Génère `config.js` depuis env / Swarm secrets, puis lance nginx           |
| `Dockerfile.prod`          | Image de production — tokens injectés au démarrage                        |
| `docker-compose.yml`       | Compose simple pour `docker compose up` (1 hôte, `.env`)                  |
| `docker-compose.prod.yml`  | Stack Docker Swarm avec secrets chiffrés + Traefik                        |
| `.env.example`             | Template des 3 variables GLPI_* (copier en `.env`)                        |
| `style.css`                | **Personnalisation** + thème + styles toast + mode-switch                 |
| `manifest.json`            | Manifest PWA v4.1.1                                                       |
| `sw.js`                    | Service worker, cache `inventory-app-cache-v7-v4-toast-hotfix`            |
| `logo.png`, `logo_picto.png` | Ressources graphiques                                                   |

---

## Déploiement

### Option A — `docker run` avec env vars (test rapide, 1 hôte)

```bash
docker build -t pwa-glpi:v4-prod -f Dockerfile.prod .
docker run -p 8085:80 \
  -e GLPI_URL=https://your-glpi.example.com/apirest.php/ \
  -e GLPI_APP_TOKEN=xxx \
  -e GLPI_USER_TOKEN=yyy \
  pwa-glpi:v4-prod
```

Au démarrage, `docker-entrypoint.sh` lit les 3 valeurs, exécute `envsubst` sur `config.template.js` pour produire `config.js`, puis lance nginx. Si une variable manque, l'entrypoint échoue **avant** le démarrage avec un message explicite.

### Option B — `docker compose up` (1 hôte, `.env` pour les secrets)

```bash
cp .env.example .env
# Éditer .env avec vos valeurs (fichier git-ignoré)
docker compose up -d --build
```

Équivalent à l'Option A mais plus propre pour itérer (pas de ligne de commande à rallonge, secrets hors du shell history).

### Option C — Docker Swarm secrets (prod multi-nœuds)

Créer les secrets sur le manager :

```bash
printf 'https://your-glpi.example.com/apirest.php/' | docker secret create pwa_glpi_api_url -
printf 'your-app-token'  | docker secret create pwa_glpi_app_token -
printf 'your-user-token' | docker secret create pwa_glpi_user_token -
```

Puis déployer la stack (remplacer `your-registry.example.com/pwa-glpi:v4-prod` par votre image poussée sur votre registry) :

```bash
docker stack deploy -c docker-compose.prod.yml pwa-glpi
```

`docker-entrypoint.sh` détecte les fichiers dans `/run/secrets/` et leur donne priorité sur les variables d'environnement. Les secrets Swarm sont chiffrés dans le Raft log, montés en `tmpfs` (jamais sur disque hôte) et invisibles dans `docker inspect`.

### Rotation des tokens

Les secrets Swarm sont immuables. Pour faire tourner un token :

```bash
# 1. Créer le nouveau secret avec un suffixe
printf 'nouveau-token' | docker secret create pwa_glpi_app_token_v2 -

# 2. Mettre à jour le compose pour pointer sur le nouveau secret, puis redeploy
docker stack deploy -c docker-compose.prod.yml pwa-glpi

# 3. Une fois validé, supprimer l'ancien
docker secret rm pwa_glpi_app_token
```

---

## Différences v3 → v4

- **Double mode sur la page Scan QR** : switch Inventaire / Manuel, persisté en `localStorage`.
- Scan en mode Manuel → affichage direct du formulaire d'édition (users_id, buy_date, inventory_date).
- **Toast de confirmation** (v4.1) : succès vert 5 s + auto-rescan / échec rouge sticky.
- **Export de logs** (v4.1) : buffer persistant + bouton « Télécharger les logs » .txt.
- Fonctions `populateUsersSelect` / `renderEquipmentInfo` factorisées dans `app_multi_v2.js` pour être partagées entre `index.html` et `recherche_manuelle.html`.
- Header mobile : pastille "Support GLPI" en mode icon-only sous 640 px (fix du débordement v2).
- Bouton « Mise à jour manuelle » renommé en « Recherche par numéro de série » (la fonction est désormais accessible par scan aussi).
- **Aucune rupture fonctionnelle** — le mode par défaut reste `Inventaire` avec le comportement historique.
- Cache service worker : `inventory-app-cache-v7-v4-toast-hotfix`.

---

## Prérequis GLPI

- Utilisateur technique avec droits :
  - `read/write` sur `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`
  - `read/write` sur `Infocom`
  - `read` sur `User` (pour `/search/User` et `/listSearchOptions/User`)
- App-Token + User-Token créés dans GLPI → Configuration → Général → API.
