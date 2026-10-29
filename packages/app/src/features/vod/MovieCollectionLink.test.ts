import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
const f = vi.hoisted(() => ({ match: vi.fn(), key: vi.fn(), discover: vi.fn(), open: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android', isTV: true }, Text: 'Text', StyleSheet: { create: (v: unknown) => v } }));
vi.mock('../../ui/TvPressable.js', () => ({ TvPressable: 'Button' }));
vi.mock('../../ui/ThemeContext.js', () => ({ useStyles: (make: (colors: unknown) => unknown) => make({ surface: '#000', text: '#fff' }) }));
vi.mock('../../storage/settings.js', () => ({ getTmdbApiKey: f.key }));
vi.mock('../../storage/movieCollections.js', () => ({ movieCollectionForItem: f.match }));
vi.mock('../../sync/movieCollections.js', () => ({ discoverMovieCollections: f.discover }));
vi.mock('../../sync/tmdb.js', () => ({ tmdbFetch: vi.fn() }));
import { MovieCollectionLink } from './MovieCollectionLink.js';
const session = { db: {} } as AppSession;
let tree: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.match.mockResolvedValue({ id: 7, name: 'Samlingen', posterUrl: null, available: 2 });
  f.key.mockResolvedValue(null); f.discover.mockResolvedValue({ changed: 0 });
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; vi.unstubAllGlobals(); });
const mount = () => act(async () => { tree = create(createElement(MovieCollectionLink, { session, itemKey: 'source:movie', onOpen: f.open })); });
it('aabner den eksisterende lokale samling uden at vente paa netvaerk', async () => {
  await mount();
  await act(async () => tree!.root.findByType('Button' as any).props.onPress());
  expect(f.open).toHaveBeenCalledWith(7);
  expect(f.discover).not.toHaveBeenCalled();
});
it('afgang fra filmen annullerer et sent metadataopslag', async () => {
  let resolve!: (value: string) => void;
  f.key.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  await mount();
  await act(async () => tree!.unmount()); tree = null;
  await act(async () => resolve('key'));
  expect(f.discover).not.toHaveBeenCalled();
});
it('en metadatafejl skjuler ikke en allerede cachet samling', async () => {
  f.key.mockResolvedValue('key'); f.discover.mockRejectedValue(new Error('offline'));
  await mount();
  expect(tree!.root.findAllByType('Button' as any)).toHaveLength(1);
});
