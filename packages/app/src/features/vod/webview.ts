import type { ComponentType } from 'react';
import type { WebViewProps } from 'react-native-webview';
import { isTV } from '../../ui/tv.js';

/**
 * Webvisningen, hvor den findes.
 *
 * tvOS har ingen webvisning, og react-native-webview bygger ikke til
 * Apple TV; modulet er slaaet fra i tv-builds (react-native.config.js).
 * Derfor hentes det bag en test i stedet for at importeres oeverst: paa
 * tv er det null, og trailerskaermen siger det i stedet for at gaa ned.
 */
export type WebViewComponent = ComponentType<WebViewProps>;

export function webView(): WebViewComponent | null {
  if (isTV) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-webview') as { WebView?: WebViewComponent };
    return loaded.WebView ?? null;
  } catch {
    return null;
  }
}
