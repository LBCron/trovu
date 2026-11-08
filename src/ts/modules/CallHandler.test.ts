import CallHandler from "./CallHandler";
import Env from "./Env";
import ShortcutFinder from "./ShortcutFinder";
import { createLogger } from "../../../tests/createLogger";
import type { Shortcut } from "../types";

describe("CallHandler", () => {
  test("getAlternative", async () => {
    const shortcut = {
      deprecated: {
        alternative: {
          query: "gm b,<1>",
        },
      },
    };
    const env = {
      args: ["brandenburger tor"],
    };
    expect(CallHandler.getAlternative(shortcut, env)).toEqual("gm b,brandenburger tor");
  });
  test("getRedirectUrlToHome", async () => {
    Env.getUrlHash = () => {
      return "country=at&language=de&query=reload";
    };
    const response = {
      status: "reloaded",
    };
    expect(CallHandler.getRedirectUrlToHome(new Env(), response)).toStrictEqual(
      "../index.html#country=at&language=de&status=reloaded",
    );
  });
  test("getRedirectUrlToHome keeps the populated query over the stale URL query", async () => {
    Env.getUrlHash = () => {
      return "country=gb&language=de&query=google&status=not_found";
    };
    const response = {
      status: "not_found",
    };
    expect(CallHandler.getRedirectUrlToHome(new Env({ query: "wikipedia" }), response)).toStrictEqual(
      "../index.html#country=gb&language=de&query=wikipedia&status=not_found",
    );
  });
  test("isSafeRedirectUrl allows http, https and mailto", () => {
    expect(CallHandler.isSafeRedirectUrl("http://example.com")).toBe(true);
    expect(CallHandler.isSafeRedirectUrl("https://example.com")).toBe(true);
    expect(CallHandler.isSafeRedirectUrl("mailto:test@example.com")).toBe(true);
  });
  test("isSafeRedirectUrl blocks unsupported protocols", () => {
    expect(CallHandler.isSafeRedirectUrl("javascript:alert(1)")).toBe(false);
  });
  test("isSafeRedirectUrl blocks unparseable URLs", () => {
    expect(CallHandler.isSafeRedirectUrl("not a url")).toBe(false);
  });
  test("getRedirectResponse returns suspicious for blocked redirect URLs", () => {
    const shortcutSpy = jest.spyOn(ShortcutFinder, "findShortcut").mockReturnValue({
      url: "javascript:alert(1)",
      reachable: true,
    } as Shortcut);
    const env = {
      query: "evil",
      args: [],
      language: "en",
      country: "us",
      logger: createLogger(),
    };

    expect(CallHandler.getRedirectResponse(env)).toMatchObject({
      status: "suspicious",
      redirectUrl: "javascript:alert(1)",
    });

    shortcutSpy.mockRestore();
  });

  test("isExternalUrl detects cross-origin http(s) URLs and ignores internal or mailto URLs", () => {
    expect(CallHandler.isExternalUrl("https://www.google.com/search?q=test")).toBe(true);
    expect(CallHandler.isExternalUrl("http://example.com/")).toBe(true);
    expect(CallHandler.isExternalUrl("../index.html#status=not_found")).toBe(false);
    expect(CallHandler.isExternalUrl("/index.html")).toBe(false);
    expect(CallHandler.isExternalUrl("mailto:test@example.com")).toBe(false);
    expect(CallHandler.isExternalUrl("not a url")).toBe(false);
  });

  test("buildAndroidIntentUrl constructs intent URI for external http(s) targets", () => {
    expect(CallHandler.buildAndroidIntentUrl("https://www.google.com/search?q=foo")).toBe(
      "intent://www.google.com/search?q=foo#Intent;scheme=https;" +
        "action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;" +
        "S.browser_fallback_url=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dfoo;end",
    );
    expect(CallHandler.buildAndroidIntentUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  test("openTargetUrl clicks a _blank anchor in standalone mode for external URLs", () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const appendSpy = jest.spyOn(document.body, "appendChild");

    const openedExternally = CallHandler.openTargetUrl(
      "https://www.google.com/",
      { isRunningStandalone: () => true },
      true,
    );

    expect(openedExternally).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(anchor.href).toBe("https://www.google.com/");

    clickSpy.mockRestore();
    appendSpy.mockRestore();
  });
});
