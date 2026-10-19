import { type ColumnsToMap } from "app/plugin/CustomSectionAPI";

import sortBy from "lodash/sortBy";

/**
 * Custom widget manifest definition.
 */
export interface ICustomWidget {
  /**
   * Widget friendly name, used on the UI.
   */
  name: string;
  /**
   * Widget unique id, probably in npm package format @gristlabs/custom-widget-name.
   *
   * There could be multiple versions of the same widget with the
   * same id, e.g. a bundled version and an external version.
   */
  widgetId: string;
  /**
   * Custom widget main page URL.
   */
  url: string;
  /**
   * Optional desired access level.
   */
  accessLevel?: AccessLevel;
  /**
   * Columns to map, which the widget can override in `grist.ready()`.
   */
  columns?: ColumnsToMap;
  /**
   * If set, Grist will render the widget after `grist.ready()`.
   *
   * This is used to defer showing a widget on initial load until it has finished
   * applying the Grist theme.
   */
  renderAfterReady?: boolean;
  /**
   * If set to false, do not offer to user in UI.
   */
  published?: boolean;
  /**
   * If the widget came from a plugin, we track that here.
   */
  source?: {
    pluginId: string;
    name: string;
  };
  /**
   * Widget description.
   */
  description?: string;
  /**
   * Widget authors.
   *
   * The first author is the one shown in the UI.
   */
  authors?: WidgetAuthor[];
  /**
   * Date the widget was last updated.
   */
  lastUpdatedAt?: string;
  /**
   * If the widget is maintained by Grist Labs.
   */
  isGristLabsMaintained?: boolean;
}

export interface WidgetAuthor {
  name: string;
  url?: string;
}

/**
 * Widget access level.
 */
export enum AccessLevel {
  /**
   * Default, no access to Grist.
   */
  none = "none",
  /**
   * Read only access to table the widget is based on.
   */
  read_table = "read table",
  /**
   * Full access to document on user's behalf.
   */
  full = "full",
}

export function isSatisfied(current: AccessLevel, minimum: AccessLevel) {
  function ordered(level: AccessLevel) {
    switch (level) {
      case AccessLevel.none: return 0;
      case AccessLevel.read_table: return 1;
      case AccessLevel.full: return 2;
      default: throw new Error(`Unrecognized access level ${level}`);
    }
  }
  return ordered(current) >= ordered(minimum);
}

/**
 * Find the best match for a widgetId/pluginId combination among the
 * given widgets. An exact widgetId match is required. A pluginId match
 * is preferred but not required.
 */
export function matchWidget(widgets: ICustomWidget[], options: {
  widgetId: string,
  pluginId?: string,
}): ICustomWidget | undefined {
  const prefs = sortBy(widgets, (w) => {
    return [
      w.widgetId !== options.widgetId,
      // Prefer an exact plugin match if pluginId is given
      !(options.pluginId && w.source?.pluginId === options.pluginId),
      // Prefer a bundled widget copy over a remotely sourced one
      !(w.source?.pluginId),
    ];
  });
  if (prefs.length === 0) { return; }
  if (prefs[0].widgetId !== options.widgetId) { return; }
  return prefs[0];
}

/**
 * Parses the value of `GRIST_CUSTOM_WIDGET_ALLOWED_URLS` (a comma-separated list) into a
 * list of entries. Returns `undefined` if the value is unset or blank, meaning that custom
 * widget URLs are not restricted.
 *
 * See {@link isCustomWidgetUrlAllowed} for the supported entry formats.
 */
export function parseCustomWidgetAllowedUrls(value: string | undefined): string[] | undefined {
  const entries = (value ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

/**
 * Returns true if `url` may be loaded by a custom widget, according to `allowedUrls`.
 *
 * If `allowedUrls` is undefined, all http(s) URLs are allowed (the default behavior of Grist).
 * Otherwise, `url` must match at least one entry. Supported entries are:
 *
 *   - `*`: allows any http(s) URL.
 *   - A URL prefix, e.g. `https://gristlabs.github.io/grist-widget/`: the URL must have the
 *     same protocol and host (including port), and its path must start with the prefix's
 *     path. A prefix path that doesn't end with "/" only matches at a path segment boundary
 *     (`https://a.com/widgets` matches `https://a.com/widgets/x` but not `https://a.com/widgets2`).
 *   - A hostname, e.g. `widgets.example.com`, or a wildcard hostname, e.g. `*.example.com`
 *     (which matches subdomains of `example.com`, but not `example.com` itself): the URL must
 *     use https and have a matching hostname. A port may be included, e.g. `example.com:8443`.
 *
 * Entries that cannot be parsed never match, so a misconfigured list fails closed.
 */
export function isCustomWidgetUrlAllowed(url: string, allowedUrls: string[] | undefined): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return false;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") { return false; }
  if (!allowedUrls) { return true; }
  return allowedUrls.some(entry => matchesAllowedUrlEntry(parsedUrl, entry));
}

function matchesAllowedUrlEntry(url: URL, entry: string): boolean {
  if (entry === "*") { return true; }

  if (entry.includes("://")) {
    let prefix: URL;
    try {
      prefix = new URL(entry);
    } catch (e) {
      return false;
    }
    if (prefix.protocol !== url.protocol || prefix.host !== url.host) { return false; }
    const prefixPath = prefix.pathname;
    if (prefixPath === "/") { return true; }
    // Some servers decode these before resolving the path, which could escape the prefix.
    if (/%2f|%5c|%2e/i.test(url.pathname)) { return false; }
    return prefixPath.endsWith("/") ?
      url.pathname.startsWith(prefixPath) :
      (url.pathname === prefixPath || url.pathname.startsWith(prefixPath + "/"));
  }

  if (url.protocol !== "https:") { return false; }
  const pattern = entry.toLowerCase();
  // Compare the port only if the entry specifies one.
  const host = pattern.includes(":") ? url.host : url.hostname;
  if (pattern.startsWith("*.")) {
    return host.endsWith(pattern.slice(1));
  }
  return host === pattern;
}
