import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import { migrate } from '../../storage/schema.js';
import { createTestDatabase } from '../../storage/testDb.js';

const f = vi.hoisted(() => ({ tv: false }));
vi.mock('react-native', () => ({
  Platform: { isTV: false, OS: 'android' },
  ScrollView: 'ScrollView', View: 'View', Text: 'Text', TextInput: 'TextInput', Switch: 'Switch', Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator', Image: 'Image',
  StyleSheet: { create: (v: unknown) => v, hairlineWidth: 0.5 },
}));
vi.mock('../../ui/tv.js', () => ({ get isTV() { return f.tv; } }));
vi.mock('../../ui/ThemeContext.js', () => ({ useStyles: (make: any) => make(new Proxy({}, { get: () => '#000' })), useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }) }));
vi.mock('../../ui/TvPressable.js', () => ({ TvPressable: 'TvPressable' }));
vi.mock('../../ui/TvTextInput.js', () => ({ TvTextInput: 'TvTextInput' }));
vi.mock('../../ui/logoCache.js', () => ({ forgetLogoMisses: async () => {}, resetLogo: async () => {} }));
vi.mock('../../ui/posterFill.js', () => ({ setPosterApiKey: () => {} }));
vi.mock('../../ui/themeMode.js', () => ({ PLACES: [{ key: 'kbh', name: 'København' }], THEME_MODES: ['sun', 'dark', 'light'], setThemePreference: () => {}, themePreference: () => ({ mode: 'sun', placeKey: 'kbh' }) }));
vi.mock('../../storage/credentials.js', () => ({ clearSourceCredentials: async () => {} }));
vi.mock('../player/uniformAudio.js', () => ({ loadUniformAudio: async () => {}, saveUniformAudio: async () => {}, useUniformAudio: () => false, UNIFORM_AUDIO_SUPPORTED: true }));
vi.mock('../player/format.js', () => ({ applyStreamFormatSetting: () => {}, applyVideoSurfaceSetting: () => {} }));
vi.mock('../player/timeshiftProbeFetch.js', () => ({ probeFetch: async () => ({ status: 0, headers: {}, text: null }) }));
vi.mock('../vod/externalSubtitles.js', () => ({ testOpenSubtitles: async () => 'ok' }));
vi.mock('./CloudBackup.js', () => ({ CloudBackup: 'CloudBackup' }));
vi.mock('./DiagnosticSettings.js', () => ({ DiagnosticSettings: 'DiagnosticSettings' }));
vi.mock('./appUpdate.js', () => ({ checkForUpdate: async () => ({ available: false }), currentVersionCode: () => 423, discardApk: async () => {}, downloadAndInstall: async () => ({ kind: 'cancelled' }), onDownloadProgress: () => () => {}, shouldDiscardAfter: () => false }));
vi.mock('../../sync/tmdbHome.js', () => ({ listTmdbProvidersWithUk: async () => [] }));
vi.mock('../../diagnostics/log.js', () => ({ recentLog: () => [], logEvent: () => {}, safe: (t: string) => t }));

import { SettingsScreen } from './SettingsScreen.js';

const GROUPS = ['Kanaler og kilder', 'Guide og programoversigt', 'Afspilning og lyd', 'Film og serier', 'Udseende', 'Sikkerhedskopi', 'Opdatering', 'Fejlfinding', 'Konto'];
let tree: ReactTestRenderer | null = null;
const text = (node: any): string => node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : text(node.children ?? node.props?.children);
const headers = () => tree!.root.findAll((n) => n.type === ('TvPressable' as any) && n.props.accessibilityState?.expanded !== undefined);
const header = (title: string) => headers().find((n) => text(n.children).includes(title))!;

async function mount(): Promise<void> {
  const db = createTestDatabase();
  await migrate(db);
  const session = { db, sources: [], access: () => undefined, credsBySource: new Map(), fetchImpl: vi.fn() } as unknown as AppSession;
  await act(async () => {
    tree = create(createElement(SettingsScreen, {
      session, onRefresh: vi.fn(), refreshing: false, onOpenSources: vi.fn(), onOpenLogos: vi.fn(), onOpenCheck: vi.fn(),
      previewEnabled: true, onPreviewEnabledChange: vi.fn(), onSignedOut: vi.fn(), onRestored: vi.fn(),
    }));
  });
}

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); f.tv = false; });
afterEach(async () => { if (tree) await act(async () => { tree!.unmount(); tree = null; }); vi.unstubAllGlobals(); });

for (const tv of [false, true]) {
  it(`${tv ? 'tv' : 'telefon'}: aabner med ni sammenfoldede grupper og uden EPG-tid`, async () => {
    f.tv = tv;
    await mount();
    expect(headers().map((n) => text(n.children).split(' ')[0])).toHaveLength(9);
    for (const title of GROUPS) expect(header(title)).toBeDefined();
    expect(headers().every((n) => n.props.accessibilityState.expanded === false)).toBe(true);
    const all = text(tree!.toJSON());
    expect(all).not.toContain('EPG-tid');
    expect(all).not.toContain('Programtider');
    expect(all).not.toContain('Arkivtid');
    expect(all).not.toContain('Log ud af panelet ▴');
  });

  it(`${tv ? 'tv' : 'telefon'}: hver gruppe kan foldes ud og tegner sit indhold; kun én ad gangen`, async () => {
    f.tv = tv;
    await mount();
    for (const title of GROUPS) {
      await act(async () => header(title).props.onPress());
      expect(header(title).props.accessibilityState.expanded).toBe(true);
      expect(headers().filter((n) => n.props.accessibilityState.expanded)).toHaveLength(1);
    }
    await act(async () => header('Guide og programoversigt').props.onPress());
    expect(text(tree!.toJSON())).toContain('Test programoversigten');
    expect(text(tree!.toJSON())).toContain('Test start forfra');
    await act(async () => header('Guide og programoversigt').props.onPress());
    expect(headers().every((n) => n.props.accessibilityState.expanded === false)).toBe(true);
    await act(async () => header('Konto').props.onPress());
    expect(text(tree!.toJSON())).toContain('Log ud');
    await act(async () => header('Afspilning og lyd').props.onPress());
    expect(text(tree!.toJSON())).toContain('Streamformat');
    expect(text(tree!.toJSON())).toContain('Ensartet lyd');
  });
}
