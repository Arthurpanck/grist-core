/**
 * custom.js — Grist Grand Lyon.
 * Loaded through GRIST_INCLUDE_CUSTOM_SCRIPT_URL=/v/1/custom.js
 *
 * Each link of `customLinks` is shown:
 *   - in the left panel of the home page (always),
 *   - as a card in "Découvrir et progresser sur Grist" on the home page,
 *     if it has a `card` (= the description under the title),
 *   - in the "Outils" panel of documents, if `inDocument: true`.
 *
 * Every element is a copy of a native Grist element (Terms of Service link,
 * "Centre d'aide" card, "Centre d'aide" link) with its text and link changed.
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
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
    card: "Déclarer un traitement de données",
    inDocument: true,
  },
];

// Number of home page cards per row on wide screens (Grist default: 4).
const HOME_CARDS_PER_ROW = 3;

// Calls `callback` once for every element matching `selector`, including the
// ones Grist creates later (Grist rebuilds its pages when navigating).
function onElement(selector, callback) {
  const run = () => document.querySelectorAll(selector).forEach(elm => {
    if (elm.dataset.dmDone) { return; }
    elm.dataset.dmDone = "1";
    callback(elm);
  });
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

// Copy of `template` with the text and link of `config`.
function cloneLink(template, linkSelector, config) {
  const clone = template.cloneNode(true);
  const link = linkSelector ? clone.querySelector(linkSelector) : clone;
  link.className = link.className.replace(/\b(test-\S+|tour-\S+)/g, "");
  link.href = config.url;
  link.target = "_blank";
  return { clone, link };
}

window.addEventListener("load", () => {
  // 1. Left panel of the home page: replaces the Terms of Service link
  //    (shown when GRIST_TERMS_OF_SERVICE_URL is set).
  onElement(".test-dm-tos", termsLink => {
    const entry = termsLink.parentElement;
    entry.replaceWith(...customLinks.map(config => {
      const { clone, link } = cloneLink(entry, "a", config);
      link.querySelector("span").textContent = config.text;
      return clone;
    }));
  });

  // 2. Home page cards: copies of the "Centre d'aide" card.
  onElement(".test-intro-help-center", helpCard => {
    helpCard.parentElement.append(...customLinks.filter(c => c.card).map(config => {
      const { clone } = cloneLink(helpCard, null, config);
      clone.querySelector("h2").textContent = config.text;
      clone.querySelector("h2").nextElementSibling.textContent = config.card;
      return clone;
    }));
    helpCard.parentElement.classList.add("dm-cards");
  });
  // Only on wide screens: Grist keeps 1 or 2 cards per row on narrow ones.
  document.head.insertAdjacentHTML("beforeend", `<style>
    @container (min-width: 860px) {
      .dm-cards { grid-template-columns: repeat(${HOME_CARDS_PER_ROW}, minmax(0, 1fr)) !important; }
    }</style>`);

  // 3. "Outils" panel of documents: copies of the "Centre d'aide" link.
  onElement('[aria-labelledby="grist-tools-heading"] .test-left-feedback', helpLink => {
    const entry = helpLink.parentElement;
    entry.after(...customLinks.filter(c => c.inDocument).map(config => {
      const { clone, link } = cloneLink(entry, "a", config);
      link.querySelector("span").textContent = config.text;
      return clone;
    }));
  });
}, { once: true });

// Matomo
(function () {
  var _paq = (window._paq = window._paq || []);
  _paq.push(["trackPageView"]);
  _paq.push(["enableLinkTracking"]);
  var u = "__URL__";
  _paq.push(["setTrackerUrl", u + "matomo.php"]);
  _paq.push(["setSiteId", "__ID__"]);
  var d = document,
    g = d.createElement("script"),
    s = d.getElementsByTagName("script")[0];
  g.async = true;
  g.src = u + "matomo.js";
  s.parentNode.insertBefore(g, s);
})();
