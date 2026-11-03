# Personnalisations Grist Grand Lyon

- `custom.js` : script chargé via `GRIST_INCLUDE_CUSTOM_SCRIPT_URL=/v/1/custom.js`
  (à placer dans le dossier `static/` de l'image). Une seule liste, `customLinks` :
  - chaque lien apparaît dans le menu de gauche de l'accueil ;
  - avec `card: "description"`, il apparaît aussi en carte dans « Découvrir et progresser sur Grist » ;
  - avec `inDocument: true`, il apparaît aussi dans le panneau « Outils » des documents.
- `custom.css` : masquer des outils du panneau « Outils » (règles prêtes, à décommenter).
  Chargé si `APP_STATIC_INCLUDE_CUSTOM_CSS=true` (fichier `static/custom.css`).
  Masquer un outil ne fait que retirer l'entrée du menu : la page reste accessible
  par son URL et les règles d'accès s'appliquent normalement.
- `docker-compose.yml` : exemple avec les variables d'environnement utiles.

## Ce qui se règle sans script (variables d'environnement)

| Carte              | Variable                    |
|--------------------|-----------------------------|
| Visite guidée      | `GRIST_ONBOARDING_VIDEO_ID` (ID YouTube uniquement) |
| Webinaires         | `GRIST_WEBINARS_URL`        |
| Centre d'aide      | `GRIST_HELP_CENTER`         |

Masquer les cartes Webinaires + Centre d'aide : `GRIST_HIDE_UI_ELEMENTS=helpCenter`
(attention : masque aussi « Centre d'aide » et « Visite guidée » dans le menu de gauche).
