# PWA GLPI — v1 (MVP)

Premier jet de la PWA d'inventaire GLPI. Scan QR/code-barres d'un équipement → mise à jour automatique du champ `inventory_date` de l'Infocom associé dans GLPI.

## Fonctionnalités

- Scan via la caméra (ZXing, reconnaît la plupart des formats 1D/2D).
- Recherche dans les 5 types d'équipements : `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`.
- Mise à jour automatique de `inventory_date` sur l'Infocom lié (PUT `/Infocom/{id}`).
- Page "mise à jour manuelle" pour saisir un numéro de série à la main (caméra non fonctionnelle, QR endommagé, etc.).
- Progressive Web App : installable sur mobile, service worker pour cache statique.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page principale : scanner QR |
| `by_serial_number.html` | Page "debug" — saisie manuelle (doublon conservé pour rétrocompatibilité) |
| `maj_mnauelle.html` | Page "mise à jour manuelle" (la typo `mnauelle` est volontairement conservée — historique) |
| `app_multi.js` | Toute la logique : session GLPI, recherche, update Infocom, scanner caméra |
| `style.css` | Styles globaux |
| `manifest.json` | Manifest PWA |
| `sw.js` | Service worker (cache statique) |
| `logo.png` | Logo affiché en tête de chaque page |
| `Dockerfile` | Image nginx servant les fichiers statiques sur le port 8085 |

## Configuration

### Tokens GLPI

Éditez `app_multi.js`, bloc `GLPI_CONFIG` en tête de fichier, et remplacez les 3 placeholders :

```js
const GLPI_CONFIG = {
    URL:        "https://your-glpi.example.com/apirest.php/",
    APP_TOKEN:  "XXX_APP_TOKEN_XXX",
    USER_TOKEN: "XXX_USER_TOKEN_XXX"
};
```

Les tokens sont **servis en clair** au navigateur (c'est le design de la v1). Ne déployez pas cette version sur un serveur accessible depuis Internet. Pour un déploiement exposé, utilisez la v2 ou la v3 qui permettent d'injecter les tokens depuis des variables d'environnement.

### Logo

Remplacez `logo.png` par votre propre logo (format PNG, largeur utile ~200 px).

### URLs internes

Les boutons "Mise à jour manuelle" / "Mise à jour via QR Code" et le lien "Support GLPI" pointent par défaut vers les placeholders `https://your-pwa.example.com/...` et `https://your-glpi.example.com/`. Éditez les `onclick="window.location.href=..."` dans `index.html`, `by_serial_number.html`, `maj_mnauelle.html` pour les adapter à vos URLs.

## Lancer en local

La caméra requiert HTTPS (ou `http://localhost`). Pour tester rapidement :

```bash
npx http-server . -p 8085    # puis ouvrir http://localhost:8085
```

## Déploiement Docker

```bash
docker build -t pwa-glpi:v1 .
docker run -p 8085:8085 pwa-glpi:v1
```

Puis reverse-proxy devant (nginx, Traefik, Caddy...) pour exposer en HTTPS.

## Limitations connues (→ voir v2 / v3)

- **Tokens dans le JS servi au navigateur** : quiconque atteint l'URL peut les récupérer. La v2 et la v3 ajoutent la possibilité d'injecter les tokens au démarrage du conteneur via `envsubst` + variables d'environnement / Docker Swarm secrets.
- **Doublon de pages** : `by_serial_number.html` et `maj_mnauelle.html` contiennent exactement la même logique. La v2 fusionne les deux en `recherche_manuelle.html`.
- **Typo `mnauelle`** (pour `manuelle`) : conservée ici pour ne pas casser les liens existants, corrigée en v2.
- **Pas d'édition de `users_id` ni de `buy_date`** : la v1 ne met à jour que `inventory_date`. La v2 ajoute l'édition de l'utilisateur associé (par email) et de la date d'achat.
- **Pas de retry sur 401** : si la session GLPI expire côté serveur, la prochaine requête échouera silencieusement. La v2 ajoute `glpiFetch` avec retry automatique unique sur 401.
- **Pas de séparation thème / branding** : logo, couleurs et URLs sont mélangés dans le HTML/CSS. La v3 externalise tout ça dans `branding.js` + variables CSS.

## Prérequis GLPI

- Utilisateur technique avec droits :
  - `read/write` sur `Computer`, `Monitor`, `Peripheral`, `NetworkEquipment`, `Phone`
  - `read/write` sur `Infocom`
- App-Token + User-Token générés dans GLPI → Configuration → Général → API.
- API GLPI activée et accessible depuis le navigateur (CORS si domaine différent).
