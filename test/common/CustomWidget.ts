import {
  ICustomWidget,
  isCustomWidgetUrlAllowed,
  matchWidget,
  parseCustomWidgetAllowedUrls,
} from "app/common/CustomWidget";

import { assert } from "chai";

describe("CustomWidget", function() {
  // Helper to create a minimal widget for testing.
  function makeWidget(widgetId: string, opts?: {
    pluginId?: string,
    url?: string,
  }): ICustomWidget {
    return {
      widgetId,
      name: widgetId,
      url: opts?.url ?? `https://example.com/${widgetId}`,
      ...(opts?.pluginId ? { source: { pluginId: opts.pluginId, name: opts.pluginId } } : {}),
    };
  }

  it("should return undefined for an empty list", function() {
    assert.isUndefined(matchWidget([], { widgetId: "w1" }));
  });

  it("should return undefined when no widget has a matching widgetId", function() {
    const widgets = [makeWidget("w1"), makeWidget("w2")];
    assert.isUndefined(matchWidget(widgets, { widgetId: "w3" }));
  });

  it("should return an exact widgetId match", function() {
    const widgets = [makeWidget("w1"), makeWidget("w2")];
    const result = matchWidget(widgets, { widgetId: "w2" });
    assert.equal(result?.widgetId, "w2");
  });

  it("should prefer a bundled widget over a non-bundled one", function() {
    const external = makeWidget("calendar", { url: "https://external.com/calendar" });
    const bundled = makeWidget("calendar", { pluginId: "bundled/grist-bundled" });
    // Order should not matter — try both orderings.
    for (const widgets of [[external, bundled], [bundled, external]]) {
      const result = matchWidget(widgets, { widgetId: "calendar" });
      assert.exists(result?.source, "expected bundled widget to be selected");
      assert.equal(result?.source?.pluginId, "bundled/grist-bundled");
    }
  });

  it("should prefer an exact pluginId match over other bundled widgets", function() {
    const bundledA = makeWidget("w1", { pluginId: "plugin-a" });
    const bundledB = makeWidget("w1", { pluginId: "plugin-b" });
    for (const widgets of [[bundledA, bundledB], [bundledB, bundledA]]) {
      const result = matchWidget(widgets, { widgetId: "w1", pluginId: "plugin-b" });
      assert.equal(result?.source?.pluginId, "plugin-b");
    }
  });

  it("should fall back to a bundled widget when pluginId doesn't match any", function() {
    const external = makeWidget("w1");
    const bundled = makeWidget("w1", { pluginId: "some-plugin" });
    const result = matchWidget([external, bundled], {
      widgetId: "w1",
      pluginId: "nonexistent-plugin",
    });
    assert.equal(result?.source?.pluginId, "some-plugin");
  });

  it("should fall back to an external widget when no bundled version exists", function() {
    const external = makeWidget("w1", { url: "https://external.com/w1" });
    const result = matchWidget([external], { widgetId: "w1", pluginId: "some-plugin" });
    assert.equal(result?.widgetId, "w1");
    assert.isUndefined(result?.source);
  });
});

describe("parseCustomWidgetAllowedUrls", function() {
  it("should return undefined when unset or blank", function() {
    assert.isUndefined(parseCustomWidgetAllowedUrls(undefined));
    assert.isUndefined(parseCustomWidgetAllowedUrls(""));
    assert.isUndefined(parseCustomWidgetAllowedUrls(" , ,"));
  });

  it("should split on commas and trim entries", function() {
    assert.deepEqual(
      parseCustomWidgetAllowedUrls(" example.com, https://a.org/widgets/ ,,*.b.net "),
      ["example.com", "https://a.org/widgets/", "*.b.net"],
    );
  });
});

describe("isCustomWidgetUrlAllowed", function() {
  function check(allowed: string | undefined, url: string) {
    return isCustomWidgetUrlAllowed(url, parseCustomWidgetAllowedUrls(allowed));
  }

  it("should allow any http(s) URL when no list is configured", function() {
    assert.isTrue(check(undefined, "https://anything.com/widget"));
    assert.isTrue(check(undefined, "http://anything.com/widget"));
  });

  it("should reject invalid and non-http(s) URLs", function() {
    for (const allowed of [undefined, "*"]) {
      assert.isFalse(check(allowed, "not a url"));
      assert.isFalse(check(allowed, "javascript:alert(1)"));
      assert.isFalse(check(allowed, "data:text/html,<script></script>"));
      assert.isFalse(check(allowed, "file:///etc/passwd"));
    }
  });

  it("should allow everything with a wildcard", function() {
    assert.isTrue(check("*", "https://anything.com/widget"));
    assert.isTrue(check("example.com,*", "http://anything.com/widget"));
  });

  it("should match hostnames exactly, over https only", function() {
    const allowed = "widgets.example.com";
    assert.isTrue(check(allowed, "https://widgets.example.com/"));
    assert.isTrue(check(allowed, "https://WIDGETS.example.com/a/b?x=1#y"));
    assert.isTrue(check(allowed, "https://widgets.example.com:8443/a"));
    assert.isFalse(check(allowed, "http://widgets.example.com/"));
    assert.isFalse(check(allowed, "https://example.com/"));
    assert.isFalse(check(allowed, "https://evil.widgets.example.com/"));
    assert.isFalse(check(allowed, "https://widgets.example.com.evil.com/"));
    assert.isFalse(check(allowed, "https://widgets.example.com@evil.com/"));
  });

  it("should match ports when the entry includes one", function() {
    const allowed = "example.com:8443";
    assert.isTrue(check(allowed, "https://example.com:8443/a"));
    assert.isFalse(check(allowed, "https://example.com/a"));
    assert.isFalse(check(allowed, "https://example.com:9000/a"));
  });

  it("should match subdomains with a wildcard hostname", function() {
    const allowed = "*.example.com";
    assert.isTrue(check(allowed, "https://a.example.com/"));
    assert.isTrue(check(allowed, "https://a.b.example.com/"));
    assert.isFalse(check(allowed, "https://example.com/"));
    assert.isFalse(check(allowed, "https://badexample.com/"));
    assert.isFalse(check(allowed, "http://a.example.com/"));
  });

  it("should match URL prefixes on protocol, host and path", function() {
    const allowed = "https://gristlabs.github.io/grist-widget/";
    assert.isTrue(check(allowed, "https://gristlabs.github.io/grist-widget/"));
    assert.isTrue(check(allowed, "https://gristlabs.github.io/grist-widget/calendar/index.html?a=1"));
    assert.isFalse(check(allowed, "https://gristlabs.github.io/grist-widget"));
    assert.isFalse(check(allowed, "https://gristlabs.github.io/grist-widget-evil/"));
    assert.isFalse(check(allowed, "https://evil.github.io/grist-widget/"));
    assert.isFalse(check(allowed, "http://gristlabs.github.io/grist-widget/"));
    assert.isFalse(check(allowed, "https://gristlabs.github.io:444/grist-widget/"));
    // Path traversal is normalized by the URL parser, or rejected when encoded.
    assert.isFalse(check(allowed, "https://gristlabs.github.io/grist-widget/../evil/"));
    assert.isFalse(check(allowed, "https://gristlabs.github.io/grist-widget/%2E%2E/evil/"));
    assert.isFalse(check(allowed, "https://gristlabs.github.io/grist-widget/..%2Fevil/"));
  });

  it("should match URL prefixes without a trailing slash at segment boundaries", function() {
    const allowed = "https://example.com/widgets";
    assert.isTrue(check(allowed, "https://example.com/widgets"));
    assert.isTrue(check(allowed, "https://example.com/widgets/map"));
    assert.isFalse(check(allowed, "https://example.com/widgets2/map"));
  });

  it("should allow a whole origin with a root URL prefix, including over http", function() {
    const allowed = "http://intranet.local:8080/";
    assert.isTrue(check(allowed, "http://intranet.local:8080/any/path"));
    assert.isFalse(check(allowed, "https://intranet.local:8080/any/path"));
    assert.isFalse(check(allowed, "http://intranet.local/any/path"));
  });

  it("should fail closed on invalid entries", function() {
    assert.isFalse(check("https://[bad", "https://example.com/"));
    assert.isFalse(check("not a domain", "https://example.com/"));
  });
});
