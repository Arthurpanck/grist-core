/**
 * custom.js — Grist Métropole de Lyon
 * ============================================================================
 * Chargé par Grist grâce à la variable d'environnement :
 *   GRIST_INCLUDE_CUSTOM_SCRIPT_URL=/v/1/custom.js
 * Le fichier doit être placé dans le dossier static/ de l'image Grist.
 *
 * CE QUE FAIT CE SCRIPT
 * Chaque lien de la liste `customLinks` ci-dessous apparaît :
 *   - dans le menu de gauche de la page d'accueil (« Ressources Grist ») : toujours ;
 *   - en carte dans « Découvrir et progresser sur Grist » (page d'accueil) :
 *     si le lien a une propriété `card` (= texte affiché sous le titre) ;
 *   - dans le panneau « Outils » à l'intérieur d'un document :
 *     si le lien a `inDocument: true`.
 *
 * COMMENT ÇA MARCHE
 * Le script ne crée rien de zéro : il recopie un élément existant de Grist et
 * change son texte et son lien. Les copies ont donc exactement le style de Grist.
 *   - menu de gauche  : copie du lien « Conditions d'utilisation »
 *                       → nécessite GRIST_TERMS_OF_SERVICE_URL (n'importe quelle URL) ;
 *   - cartes          : copie de la carte « Centre d'aide » ;
 *   - panneau Outils  : copie du lien « Centre d'aide ».
 *     → le Centre d'aide doit rester actif : NE PAS utiliser
 *       GRIST_HIDE_UI_ELEMENTS=helpCenter (le masquer en CSS ne pose pas de problème).
 *
 * POUR AJOUTER / MODIFIER UN BOUTON : modifier uniquement la liste `customLinks`.
 * ============================================================================
 */
const customLinks = [
  {
    text: "Guide d'utilisation",
    url: "https://comete.grandlyon.fr/jcms/26103058_DBFileDocument/guide-des-bons-usages-grist",
  },
  {
    text: "Se Former",
    url: "https://grist.grandlyon.fr/o/espace-metropole/doc/uWGkyURHCJxY",
    card: "Formations et ressources Grist",
    inDocument: true,
  },
  {
    text: "Discuter",
    url: "https://discuter-mdl.territoirenumeriqueouvert.org/#/room/#Grist-Utilisateurs:discuter-mdl.territoirenumeriqueouvert.org",
    card: "Échanger avec les utilisateurs Grist",
    inDocument: true,
  },
  {
    text: "Aide IA",
    url: "https://n8n.projets.erasme.org/webhook/24be03d3-821e-461c-93a1-a79391b360ec/chat",
  },
  {
    text: "Se Faire Accompagner",
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
    card: "Demander un accompagnement",
    inDocument: true,
  },
  {
    text: "Déclarer RGPD",
    // ⚠ Même adresse que « Se Faire Accompagner » : à remplacer par le formulaire RGPD.
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
    card: "Déclarer un traitement de données",
    inDocument: true,
  },
];

// Nombre de cartes par ligne sur grand écran (Grist : 4 par défaut).
// Sur écran étroit, Grist garde 1 ou 2 cartes par ligne.
const HOME_CARDS_PER_ROW = 3;


/* ----------------------------------------------------------------------------
 * Outils internes (pas besoin d'y toucher)
 * ------------------------------------------------------------------------- */

// Appelle `callback` une fois pour chaque élément correspondant à `selector`,
// y compris ceux que Grist crée plus tard. Nécessaire car Grist redessine ses
// pages (retour à l'accueil, ouverture d'un document) sans recharger la page.
// Chaque élément traité est marqué (data-dm-done) pour ne pas être traité deux fois.
function onElement(selector, callback) {
  const run = () => document.querySelectorAll(selector).forEach(elm => {
    if (elm.dataset.dmDone) { return; }
    elm.dataset.dmDone = "1";
    callback(elm);
  });
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

// Recopie `template` et y met le lien de `config`.
// On retire les classes « test-… » / « tour-… » de la copie : ce sont les
// identifiants de l'élément d'origine. Sans ça, une règle CSS qui masque
// l'original (ex. carte Centre d'aide) masquerait aussi les copies.
function cloneLink(template, linkSelector, config) {
  const clone = template.cloneNode(true);
  const link = linkSelector ? clone.querySelector(linkSelector) : clone;
  link.className = link.className.replace(/\b(test-\S+|tour-\S+)/g, "");
  link.href = config.url;
  link.target = "_blank";
  return { clone, link };
}


/* ----------------------------------------------------------------------------
 * Ajout des liens
 * ------------------------------------------------------------------------- */
window.addEventListener("load", () => {
  // 1. Menu de gauche de l'accueil : le lien « Conditions d'utilisation »
  //    (.test-dm-tos) est remplacé par un lien par entrée de `customLinks`.
  //    Changement par rapport à l'ancien script : plus besoin d'attendre
  //    gristApp.topAppModel.appObs ; ce lien n'existe que sur l'accueil.
  onElement(".test-dm-tos", termsLink => {
    const entry = termsLink.parentElement;
    entry.replaceWith(...customLinks.map(config => {
      const { clone, link } = cloneLink(entry, "a", config);
      link.querySelector("span").textContent = config.text;
      return clone;
    }));
  });

  // 2. Cartes de l'accueil : une copie de la carte « Centre d'aide » par lien
  //    ayant un `card`, ajoutée après les cartes de Grist.
  //    (h2 = titre de la carte, l'élément suivant = sa description)
  onElement(".test-intro-help-center", helpCard => {
    helpCard.parentElement.append(...customLinks.filter(c => c.card).map(config => {
      const { clone } = cloneLink(helpCard, null, config);
      clone.querySelector("h2").textContent = config.text;
      clone.querySelector("h2").nextElementSibling.textContent = config.card;
      return clone;
    }));
    helpCard.parentElement.classList.add("dm-cards");
  });
  // Nombre de cartes par ligne, uniquement sur grand écran (même seuil que Grist).
  document.head.insertAdjacentHTML("beforeend", `<style>
    @container (min-width: 860px) {
      .dm-cards { grid-template-columns: repeat(${HOME_CARDS_PER_ROW}, minmax(0, 1fr)) !important; }
    }</style>`);

  // 3. Panneau « Outils » d'un document : une copie du lien « Centre d'aide »
  //    par lien ayant `inDocument: true`, insérée juste en dessous.
  onElement('[aria-labelledby="grist-tools-heading"] .test-left-feedback', helpLink => {
    const entry = helpLink.parentElement;
    entry.after(...customLinks.filter(c => c.inDocument).map(config => {
      const { clone, link } = cloneLink(entry, "a", config);
      link.querySelector("span").textContent = config.text;
      return clone;
    }));
  });
}, { once: true });


/* ----------------------------------------------------------------------------
 * Matomo
 * Remplacer __URL__ (avec le « / » final) et __ID__ par les valeurs Matomo.
 * Ajout : tant que __URL__ n'est pas remplacé, Matomo n'est pas chargé.
 * Sinon le navigateur charge une page HTML à la place de matomo.js et Grist
 * affiche une erreur « Unexpected token '<' ».
 * ------------------------------------------------------------------------- */
(function () {
  var u = "__URL__";
  if (u.indexOf("__") === 0) { return; }
  var _paq = (window._paq = window._paq || []);
  _paq.push(["trackPageView"]);
  _paq.push(["enableLinkTracking"]);
  _paq.push(["setTrackerUrl", u + "matomo.php"]);
  _paq.push(["setSiteId", "__ID__"]);
  var d = document,
    g = d.createElement("script"),
    s = d.getElementsByTagName("script")[0];
  g.async = true;
  g.src = u + "matomo.js";
  s.parentNode.insertBefore(g, s);
})();
