import { makeT } from "app/client/lib/localization";
import { isCustomWidgetUrlAllowed } from "app/common/CustomWidget";
import { getGristConfig } from "app/common/urlUtils";

const t = makeT("customWidgetUrl");

/**
 * Returns true if `url` may be used by a Custom URL widget, according to the list of
 * allowed URLs configured by the administrator (`GRIST_CUSTOM_WIDGET_ALLOWED_URLS`).
 *
 * Always true when no list is configured.
 */
export function isCustomWidgetUrlAllowedByConfig(url: string): boolean {
  return isCustomWidgetUrlAllowed(url, getGristConfig().customWidgetAllowedUrls);
}

/**
 * Message shown when a user enters a Custom URL widget URL that is not allowed.
 */
export function getCustomWidgetUrlNotAllowedMessage(): string {
  return t("This URL is not allowed by your administrator. \
Only custom widgets from approved sources can be added.");
}
