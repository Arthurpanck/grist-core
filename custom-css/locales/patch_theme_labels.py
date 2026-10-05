#!/usr/bin/env python3
"""
Renomme les entrées du menu « Profil > Apparence » de Grist, pour la variante
custom_Grist_contraste-par-defaut.css (où « Clair » affiche le contraste élevé et
« Clair (contraste élevé) » affiche Métropole).

Usage :
  # 1. Copier les traductions de la version de Grist en service
  docker cp <conteneur_grist>:/grist/static/locales ./locales-metropole
  # 2. Renommer les entrées du menu
  python3 patch_theme_labels.py ./locales-metropole
  # 3. Monter le dossier dans le conteneur et le déclarer :
  #      volumes:      ./locales-metropole:/custom-locales:ro
  #      environment:  GRIST_LOCALES_DIR=/custom-locales

À refaire à chaque mise à jour de Grist : sinon les nouveaux textes de Grist
s'afficheraient en anglais.
"""
import json
import sys
from pathlib import Path

# Clé = libellé d'origine (identifiant du texte dans Grist), valeur = nouveau libellé.
LABELS = {
    "fr": {
        "Light": "Clair (contraste élevé)",
        "Light (High Contrast)": "Clair Métropole",
    },
    "en": {
        "Light": "Light (High Contrast)",
        "Light (High Contrast)": "Light (Métropole)",
    },
}


def main(locales_dir: Path) -> None:
    for lang, labels in LABELS.items():
        path = locales_dir / f"{lang}.client.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("ThemeConfig", {}).update(labels)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
        print(f"{path}: {data['ThemeConfig']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
