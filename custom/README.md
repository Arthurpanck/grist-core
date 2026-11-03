# Personnalisations Grist Grand Lyon

- `custom.js` : script chargé via `GRIST_INCLUDE_CUSTOM_SCRIPT_URL=/v/1/custom.js`
  (à placer dans le dossier `static/` de l'image).
  - liens supplémentaires du menu de gauche (`customLinks`) ;
  - cartes « Découvrir et progresser sur Grist » de la page d'accueil (`homeCards`) :
    modifier les cartes natives (`override`), les masquer (`hide`), en ajouter (`add`),
    nombre de colonnes (`columns`).
- `docker-compose.yml` : exemple avec les variables d'environnement utiles.

## Ce qui se règle sans script (variables d'environnement)

| Carte              | Variable                    |
|--------------------|-----------------------------|
| Visite guidée      | `GRIST_ONBOARDING_VIDEO_ID` (ID YouTube uniquement) |
| Webinaires         | `GRIST_WEBINARS_URL`        |
| Centre d'aide      | `GRIST_HELP_CENTER`         |

Masquer les cartes Webinaires + Centre d'aide : `GRIST_HIDE_UI_ELEMENTS=helpCenter`
(attention : masque aussi « Centre d'aide » et « Visite guidée » dans le menu de gauche).
