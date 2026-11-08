/** @module CallHandler */
import Env from "./Env";
import GitLogger from "./GitLogger";
import ShortcutFinder from "./ShortcutFinder";
import UrlProcessor from "./UrlProcessor";
import type { EnvLike, RedirectResponse, Shortcut } from "../types";

/** Handle a call. */

export default class CallHandler {
  /**
   * The 'main' function of this class.
   */
  static async handleCall() {
    const targetDomain = document.querySelector<HTMLElement>("#target-domain");
    if (!targetDomain) {
      throw new Error('Missing element "#target-domain".');
    }
    targetDomain.textContent = "";

    const env = new Env({ context: "process" });
    const params = Env.getParamsFromUrl();
    await env.populate(params);
    new GitLogger(env.gitInfo).logVersion();

    if (env.debug) {
      env.logger.showLog();
    }

    let redirectUrl: string;

    const response = this.getRedirectResponse(env);

    if (response.status === "found") {
      redirectUrl = response.redirectUrl as string;
    } else {
      redirectUrl = this.getRedirectUrlToHome(env, response);
    }

    targetDomain.textContent = typeof response.redirectUrl === "string" ? response.redirectUrl : "";

    env.logger.info("Redirect to:   " + redirectUrl);

    if (env.debug) {
      return;
    }

    this.openTargetUrl(redirectUrl, env, true);
  }

  /**
   * Check whether a redirect URL is an external http(s) URL outside the current origin.
   */
  static isExternalUrl(redirectUrl: string): boolean {
    if (
      !redirectUrl ||
      redirectUrl.startsWith("../") ||
      redirectUrl.startsWith("./") ||
      redirectUrl.startsWith("/") ||
      redirectUrl.startsWith("#")
    ) {
      return false;
    }
    try {
      const baseOrigin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const parsedUrl = baseOrigin ? new URL(redirectUrl, baseOrigin) : new URL(redirectUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return false;
      }
      return !baseOrigin || parsedUrl.origin !== baseOrigin;
    } catch {
      return false;
    }
  }

  /**
   * Build an Android intent:// URI for an external http(s) URL so Android can dispatch
   * it to a matching native app or external browser handler.
   */
  static buildAndroidIntentUrl(redirectUrl: string): string {
    if (!this.isExternalUrl(redirectUrl)) {
      return redirectUrl;
    }
    const parsedUrl = new URL(redirectUrl);
    const scheme = parsedUrl.protocol.slice(0, -1);
    const targetPath = `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
    return (
      `intent://${targetPath}#Intent;scheme=${scheme};` +
      `action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;` +
      `S.browser_fallback_url=${encodeURIComponent(redirectUrl)};end`
    );
  }

  /**
   * Navigate to a resolved redirect URL. When running in a standalone PWA and the target
   * is an external http(s) URL, hand off navigation outside the PWA window.
   */
  static openTargetUrl(
    redirectUrl: string,
    env?: Pick<Env, "isRunningStandalone">,
    replace = false,
  ): boolean {
    const isStandalone = Boolean(env?.isRunningStandalone?.());
    if (isStandalone && this.isExternalUrl(redirectUrl) && typeof document !== "undefined") {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
      const href = /Android/i.test(userAgent) ? this.buildAndroidIntentUrl(redirectUrl) : redirectUrl;
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body?.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    }

    if (replace) {
      window.location.replace(redirectUrl);
    } else {
      window.location.href = redirectUrl;
    }
    return false;
  }

  /**
   * Given the environment, get a response object, incl. redirect URL.
   *
   * @param {object} env        - The environment.
   *
   * @return {object} response  - Contains redirect URL, status.
   */
  static getRedirectResponse(env: EnvLike): RedirectResponse {
    if (env.reload && !env.query) {
      return { status: "reloaded" };
    }

    if (!env.query) {
      return { status: "not_found", redirectUrl: false };
    }

    const shortcut = ShortcutFinder.findShortcut(env);

    if (!shortcut) {
      return { status: "not_found" };
    }

    if (shortcut.deprecated) {
      return {
        status: "deprecated",
        alternative: this.getAlternative(shortcut, env),
      };
    }

    if (shortcut.removed) {
      return {
        status: "removed",
        key: shortcut.key,
      };
    }

    if (!shortcut.reachable) {
      return {
        status: "not_reachable",
        namespace: shortcut.namespace,
      };
    }

    let redirectUrl = shortcut.url || "";

    env.logger.info("Used template: " + redirectUrl);

    redirectUrl = UrlProcessor.replaceVariables(redirectUrl, {
      language: env.language,
      country: env.country,
    });
    redirectUrl = UrlProcessor.replaceArguments(redirectUrl, env.args, env);

    if (!this.isSafeRedirectUrl(redirectUrl)) {
      return {
        status: "suspicious",
        redirectUrl,
      };
    }

    return {
      status: "found",
      redirectUrl,
    };
  }

  static getAlternative(shortcut: Shortcut, env: Pick<EnvLike, "args">): string {
    let alternative = shortcut.deprecated.alternative.query;
    for (const i in env.args) {
      alternative = alternative.replace("<" + (parseInt(i) + 1) + ">", env.args[i]);
    }
    return alternative;
  }

  static isSafeRedirectUrl(redirectUrl: string): boolean {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(redirectUrl);
    } catch {
      return false;
    }
    return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol);
  }

  /**
   * Redirect in case a shortcut was not found.
   *
   * @param {string} status       - The status of the call.
   *
   * @return {string} redirectUrl - Redirect URL to the homepage, with parameters.
   */
  static getRedirectUrlToHome(env: Pick<Env, "buildUrlParamStr">, response: RedirectResponse): string {
    const params = Env.getParamsFromUrl();
    delete params.query;
    for (const property of ["alternative", "key", "namespace", "status"]) {
      if (response[property]) {
        params[property] = response[property];
      }
    }
    const paramStr = env.buildUrlParamStr(params);
    const redirectUrl = "../index.html#" + paramStr;
    return redirectUrl;
  }
}
