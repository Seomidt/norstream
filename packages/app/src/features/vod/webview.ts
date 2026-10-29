import type { ComponentType, Ref } from 'react';
import { Platform } from 'react-native';
import type { WebView, WebViewProps } from 'react-native-webview';
import { isTV } from '../../ui/tv.js';

/**
 * Webvisningen, hvor den findes.
 *
 * tvOS har ingen webvisning, og react-native-webview bygger ikke til
 * Apple TV; modulet er slaaet fra i tv-builds til iOS
 * (react-native.config.js). Derfor hentes det bag en test i stedet for
 * at importeres oeverst: paa Apple TV er det null, og trailerskaermen
 * siger det i stedet for at gaa ned. Android TV og Google TV har
 * Androids webvisning, saa dér spiller traileren som paa telefonen.
 */
export type WebViewComponent = ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

/** Kun Apple TV mangler webvisningen. */
export const webViewMissing: boolean = isTV && Platform.OS === 'ios';

export function webView(): WebViewComponent | null {
  if (webViewMissing) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-webview') as { WebView?: WebViewComponent };
    return loaded.WebView ?? null;
  } catch {
    return null;
  }
}
