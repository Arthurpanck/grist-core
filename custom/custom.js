/**
 * custom.js — Grist Grand Lyon customisations.
 *
 * Loaded through GRIST_INCLUDE_CUSTOM_SCRIPT_URL (e.g. /v/1/custom.js).
 *
 *  1. Extra links in the left panel ("Ressources Grist"), cloned from the
 *     Terms of Service link (requires GRIST_TERMS_OF_SERVICE_URL to be set).
 *  2. Home page cards "Découvrir et progresser sur Grist":
 *       - change the text / link of the native cards,
 *       - hide native cards,
 *       - add new cards, built the same way as the native ones.
 *  3. "Outils" panel inside a document: extra links after "Centre d'aide".
 *     (To hide native tools, see custom.css.)
 *  4. Matomo tracking.
 */

// ---------------------------------------------------------------------------
// 1. Left panel links
// ---------------------------------------------------------------------------
const customLinks = [
  {
    text: "Guide d'utilisation",
    url: "https://comete.grandlyon.fr/jcms/26103058_DBFileDocument/guide-des-bons-usages-grist",
  },
  {
    text: "Se Former",
    url: "https://grist.grandlyon.fr/o/espace-metropole/doc/uWGkyURHCJxY",
  },
  {
    text: "Aide IA",
    url: "https://n8n.projets.erasme.org/webhook/24be03d3-821e-461c-93a1-a79391b360ec/chat",
  },
  {
    text: "Se Faire Accompagner",
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
  },
  {
    text: "Déclarer RGPD",
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
  },
];

// ---------------------------------------------------------------------------
// 2. Home page cards ("Découvrir et progresser sur Grist")
// ---------------------------------------------------------------------------
const homeCards = {
  // Number of cards per row on wide screens (Grist default: 4). null = keep default.
  columns: 3,

  // Native cards to hide. Ids: "video-tour", "tutorial", "webinars", "help-center".
  hide: [],

  // Changes to native cards. Every key is optional:
  //   title, description, url, newTab (default true).
  // For "video-tour", setting `url` opens that page instead of the YouTube popup
  // (to only change the YouTube video, use GRIST_ONBOARDING_VIDEO_ID instead).
  // Note: the webinars / help center links can also be set without this script,
  // with GRIST_WEBINARS_URL and GRIST_HELP_CENTER.
  override: {
    // "webinars": { url: "https://exemple.grandlyon.fr/webinaires" },
    // "help-center": { description: "Documentation officielle de Grist" },
  },

  // New cards, appended after the native ones, in this order.
  //   icon: id of the native card whose icon to reuse ("help-center",
  //         "webinars", "video-tour", "tutorial"), or an image URL.
  add: [
    {
      id: "se-former",
      title: "Se former",
      description: "Formations et ressources Grist",
      url: "https://grist.grandlyon.fr/o/espace-metropole/doc/uWGkyURHCJxY",
      icon: "help-center",
    },
    {
      id: "se-faire-accompagner",
      title: "Se faire accompagner",
      description: "Demander un accompagnement",
      url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
      icon: "help-center",
    },
    {
      id: "declaration-rgpd",
      title: "Déclaration RGPD",
      description: "Déclarer un traitement de données",
      url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
      icon: "help-center",
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. "Outils" panel inside a document
// ---------------------------------------------------------------------------
// Links added after "Centre d'aide" (cloned from it, so they open in a new tab
// and show the external link icon).
//   iconMask: name of a Grist icon (e.g. "Help", "Log", "Settings"); default "Help".
const docToolsLinks = [
  {
    text: "Se former",
    url: "https://grist.grandlyon.fr/o/espace-metropole/doc/uWGkyURHCJxY",
  },
  {
    text: "Se faire accompagner",
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
  },
  {
    text: "Déclarer RGPD",
    url: "https://services.formulaireintranet.grandlyon.com/demande-accompagnement-grist/",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// from https://stackoverflow.com/a/61511955
function waitForElm(selector) {
  return new Promise(resolve => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function setLink(linkElm, url, newTab) {
  linkElm.href = url;
  if (newTab === false) {
    linkElm.removeAttribute("target");
  } else {
    linkElm.target = "_blank";
    linkElm.rel = "noopener noreferrer";
  }
}

function setCardTexts(card, config) {
  const titleElm = card.querySelector("h2");
  const descElm = titleElm && titleElm.nextElementSibling;
  if (config.title !== undefined && titleElm) { titleElm.textContent = config.title; }
  if (config.description !== undefined && descElm) { descElm.textContent = config.description; }
}

// ---------------------------------------------------------------------------
// Home cards
// ---------------------------------------------------------------------------
const CARD_PREFIX = "test-intro-";
const DONE_ATTR = "data-dm-custom-cards";

function customizeHomeCards(container) {
  if (container.hasAttribute(DONE_ATTR)) { return; }
  container.setAttribute(DONE_ATTR, "1");

  const nativeCard = id => container.querySelector(`.${CARD_PREFIX}${id}`);

  // Template for new cards: a native link card (help center or webinars).
  const template = nativeCard("help-center") || nativeCard("webinars");

  // Overrides of native cards.
  for (const [id, config] of Object.entries(homeCards.override || {})) {
    let card = nativeCard(id);
    if (!card) { continue; }
    if (config.url && card.tagName !== "A") {
      // The video tour card is a <button> opening a popup: replace it with a link.
      const link = document.createElement("a");
      for (const attr of card.attributes) {
        if (attr.name !== "type") { link.setAttribute(attr.name, attr.value); }
      }
      if (template) {
        // Take the link styling of the template, but not its test-intro-* identifier.
        link.className = template.className;
        [...link.classList].filter(c => c.startsWith(CARD_PREFIX)).forEach(c => link.classList.remove(c));
        link.classList.add(`${CARD_PREFIX}${id}`);
      }
      link.append(...card.childNodes);
      card.replaceWith(link);
      card = link;
    }
    if (config.url) { setLink(card, config.url, config.newTab); }
    setCardTexts(card, config);
  }

  // New cards.
  if (template) {
    const iconOf = id => {
      const card = nativeCard(id);
      return card && card.firstElementChild;
    };
    for (const config of homeCards.add || []) {
      const card = template.cloneNode(true);
      card.classList.remove(`${CARD_PREFIX}help-center`, `${CARD_PREFIX}webinars`);
      if (config.id) { card.classList.add(`dm-card-${config.id}`); }
      setLink(card, config.url, config.newTab);
      setCardTexts(card, config);

      if (config.icon) {
        const iconHolder = card.firstElementChild;
        const source = iconOf(config.icon);
        if (source) {
          iconHolder.replaceWith(source.cloneNode(true));
        } else {
          // Treat it as an image URL.
          const img = iconHolder.querySelector("img") || document.createElement("img");
          img.src = config.icon;
          img.alt = "";
          iconHolder.replaceChildren(img);
        }
      }
      container.appendChild(card);
    }
  }

  // Hide native cards (done last so that their icons can still be reused).
  for (const id of homeCards.hide || []) {
    const card = nativeCard(id);
    if (card) { card.style.display = "none"; }
  }

  if (homeCards.columns) {
    container.classList.add("dm-custom-cards");
  }
}

function installHomeCardsStyle() {
  if (!homeCards.columns) { return; }
  const style = document.createElement("style");
  style.textContent = `
    @container (min-width: 860px) {
      .dm-custom-cards {
        grid-template-columns: repeat(${homeCards.columns}, minmax(0, 1fr)) !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function watchHomeCards() {
  installHomeCardsStyle();
  const apply = () => {
    const container = document.querySelector(`.${CARD_PREFIX}cards:not([${DONE_ATTR}])`);
    if (container) { customizeHomeCards(container); }
  };
  apply();
  // The home page is rebuilt when navigating or toggling "Only show documents":
  // re-apply every time the cards container is (re)created.
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Left panel links
// ---------------------------------------------------------------------------
async function addLeftPanelLinks() {
  await waitForElm("body.interface-full");
  const appObs = window.gristApp && gristApp.topAppModel && gristApp.topAppModel.appObs;
  if (!appObs) {
    return;
  }
  // appObs is not populated at that point, listen for the observer to their first change
  appObs.addListener(async (appObs) => {
    // At date customs links must be displayed only in home page
    if (appObs.pageType.get() !== "home") {
      return 1;
    }
    // Terms of service link displayed when GRIST_TERMS_OF_SERVICE_URL is set
    // have as classe identifier test-dm-tos
    const termsLink = await waitForElm(".test-dm-tos");

    const menuElement = termsLink.parentElement;
    menuElement.insertAdjacentHTML("afterEnd", "<style>.dm-menu-no-hover:hover{ background-color: inherit !important; }</style>");
    const newLinks = customLinks.map(config => {
      if (config === "---") {
        return document.createElement("hr");
      }
      const menuClone = menuElement.cloneNode(true);
      const linkElm = menuClone.querySelector(".test-dm-tos");
      const textElm = linkElm.querySelector("span");
      const iconElm = linkElm.querySelector('div[style*="mask-image"]');
      textElm.textContent = config.text;
      linkElm.classList.remove("test-dm-tos");

      if (config.url) {
        linkElm.href = config.url;
      } else {
        linkElm.removeAttribute("href");
        linkElm.style.cursor = "text";
      }

      if (config.newTab === false) {
        linkElm.removeAttribute("target");
        menuClone.classList.add("dm-menu-no-hover");
      }
      if (config.iconMask === null) {
        iconElm.remove();
      } else if (config.iconMask !== undefined) {
        iconElm.style["mask-image"] = `var(--icon-${config.iconMask})`;
      }

      return menuClone;
    });
    menuElement.replaceWith(...newLinks);
  });
}

// ---------------------------------------------------------------------------
// Document tools links
// ---------------------------------------------------------------------------
const DOC_TOOLS_DONE_ATTR = "data-dm-custom-tools";

function addDocToolsLinks(helpLink) {
  const entry = helpLink.parentElement;
  const panel = entry.parentElement;
  if (!panel || panel.hasAttribute(DOC_TOOLS_DONE_ATTR)) { return; }
  panel.setAttribute(DOC_TOOLS_DONE_ATTR, "1");

  const newEntries = docToolsLinks.map(config => {
    const clone = entry.cloneNode(true);
    const link = clone.querySelector("a");
    link.classList.remove("test-left-feedback", "tour-help-center");
    link.classList.add("dm-tools-link");
    setLink(link, config.url, config.newTab);
    link.querySelector("span").textContent = config.text;
    if (config.iconMask) {
      const iconElm = link.querySelector('div[style*="mask-image"]');
      if (iconElm) { iconElm.style.maskImage = `var(--icon-${config.iconMask})`; }
    }
    if (config.newTab === false) {
      const externalIcon = link.querySelectorAll('div[style*="mask-image"]')[1];
      if (externalIcon) { externalIcon.remove(); }
    }
    return clone;
  });
  entry.after(...newEntries);
}

function watchDocTools() {
  if (!docToolsLinks.length) { return; }
  const apply = () => {
    // The "Centre d'aide" link of the "Outils" panel (only present inside a document).
    const helpLink = document.querySelector(
      `[aria-labelledby="grist-tools-heading"]:not([${DOC_TOOLS_DONE_ATTR}]) > * > .test-left-feedback`);
    if (helpLink) { addDocToolsLinks(helpLink); }
  };
  apply();
  // The panel is rebuilt when opening another document: re-apply each time.
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
}

window.addEventListener("load", () => {
  watchHomeCards();
  watchDocTools();
  addLeftPanelLinks();
}, { once: true });

// ---------------------------------------------------------------------------
// 4. Matomo
// ---------------------------------------------------------------------------
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
