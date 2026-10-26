import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlDatabase } from '../../storage/types.js';

const f = vi.hoisted(() => ({ sources: vi.fn(), epg: vi.fn(), archive: vi.fn(), save: vi.fn(), changed: vi.fn() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('../../ui/TvPressable.js', () => ({ TvPressable: 'TvPressable' }));
vi.mock('../../ui/ThemeContext.js', () => ({
  useStyles: (make: (colors: unknown) => unknown) => make({ text: '#fff', textMuted: '#aaa', surface: '#111', surfaceRaised: '#222' }),
}));
vi.mock('../../storage/sources.js', () => ({ listSources: f.sources }));
vi.mock('../../storage/epgTiming.js', () => ({ getEpgTimeShift: f.epg, getArchiveTimeShift: f.archive, setEpgTimeShifts: f.save }));

import { EpgTimingSettings } from './EpgTimingSettings.js';

const db = {} as SqlDatabase;
const otherDb = {} as SqlDatabase;
const panelA = { id: 'panel-a', name: 'Mit panel', enabled: true, kind: 'xtream' };
const panelB = { id: 'panel-b', name: 'Ekstra panel', enabled: true, kind: 'xtream' };
let tree: ReactTestRenderer | null = null;
const mount = async (database = db) => act(async () => { tree = create(createElement(EpgTimingSettings, { db: database, onChanged: f.changed })); });
const texts = () => tree!.root.findAllByType('Text' as any).map(node => node.children.join('')).join(' | ');
const control = (label: string) => tree!.root.findByProps({ accessibilityLabel: label });
const press = async (label: string) => act(async () => { control(label).props.onPress(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.sources.mockReset().mockResolvedValue([panelA, panelB]);
  f.epg.mockReset().mockImplementation(async (_db: SqlDatabase, id: string) => id === panelA.id ? 60 : 0);
  f.archive.mockReset().mockImplementation(async (_db: SqlDatabase, id: string) => id === panelA.id ? 60 : 0);
  f.save.mockReset().mockResolvedValue(undefined);
  f.changed.mockReset(); tree = null;
});
afterEach(async () => {
  if (tree !== null) await act(async () => { tree!.unmount(); tree = null; });
  vi.unstubAllGlobals();
});

describe('kildens EPG-tid og arkivtid', () => {
  it('viser en aktiveret kildes to korrektioner og skjuler fravalgte kilder', async () => {
    f.sources.mockResolvedValue([panelA, { ...panelB, enabled: false }]);
    await mount();
    expect(texts()).toContain('Mit panel');
    expect(texts()).toContain('Programtider: +1 time');
    expect(texts()).toContain('Arkivtid: +1 time');
    expect(texts()).not.toContain('Ekstra panel');
    expect(f.epg).toHaveBeenCalledTimes(1);
    expect(tree!.root.findAllByType('TvPressable' as any)).toHaveLength(6);
  });

  it('retter programtid og arkivtid hver for sig uden at aendre en anden kilde', async () => {
    await mount();
    await press('Mit panel: Arkivtid, +1 time');
    expect(f.save).toHaveBeenLastCalledWith(db, panelA.id, { epgMinutes: 60, archiveMinutes: 120 });
    expect(texts()).toContain('Arkivtid: +2 timer');
    await press('Mit panel: Programtider, −1 time');
    expect(f.save).toHaveBeenLastCalledWith(db, panelA.id, { epgMinutes: 0, archiveMinutes: 120 });
    expect(f.save.mock.calls.every(call => call[1] === panelA.id)).toBe(true);
    expect(texts()).toContain('Ekstra panel');
    expect(texts()).toContain('Arkivtid: 0 minutter');
    expect(f.changed).toHaveBeenCalledTimes(2);
  });

  it('nulstiller kun den valgte korrektion', async () => {
    await mount();
    await press('Mit panel: Programtider, Nulstil');
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledWith(db, panelA.id, { epgMinutes: 0, archiveMinutes: 60 });
    expect(texts()).toContain('Programtider: 0 minutter');
    expect(texts()).toContain('Arkivtid: +1 time');
  });

  it.each([-720, 720])('bevarer fokusknapper ved graensen %i uden at gemme en ugyldig time', async minutes => {
    f.epg.mockResolvedValue(minutes);
    await mount();
    const label = `Mit panel: Programtider, ${minutes < 0 ? '−1 time' : '+1 time'}`;
    expect(control(label).props.disabled).toBeUndefined();
    await press(label);
    expect(f.save).not.toHaveBeenCalled();
    expect(control(label)).toBeDefined();
  });

  it('et dobbelttryk under gemning giver kun en skrivning og mister ikke fokus', async () => {
    const pending = deferred<void>(); f.save.mockReturnValue(pending.promise);
    await mount();
    await press('Mit panel: Programtider, +1 time');
    await press('Mit panel: Programtider, +1 time');
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(control('Mit panel: Programtider, +1 time').props.accessibilityState.busy).toBe(true);
    expect(control('Mit panel: Programtider, +1 time').props.disabled).toBeUndefined();
    await act(async () => pending.resolve());
    expect(texts()).toContain('Programtider: +2 timer');
    await press('Mit panel: Arkivtid, −1 time');
    expect(f.save).toHaveBeenLastCalledWith(db, panelA.id, { epgMinutes: 120, archiveMinutes: 0 });
  });

  it('viser en fast fejltekst og beholder de viste tider hvis gemning fejler', async () => {
    f.save.mockRejectedValueOnce(new Error('https://private.invalid/user/password'));
    await mount(); await press('Mit panel: Programtider, +1 time');
    expect(texts()).toContain('Tiden kunne ikke gemmes. Prøv igen.');
    expect(texts()).toContain('Programtider: +1 time');
    expect(texts()).not.toContain('password');
    expect(f.changed).not.toHaveBeenCalled();
    await press('Mit panel: Programtider, +1 time');
    expect(texts()).toContain('Programtider: +2 timer');
  });

  it('viser kun programtid for en M3U-kilde', async () => {
    f.sources.mockResolvedValue([{ ...panelA, kind: 'm3u' }]);
    await mount();
    expect(texts()).toContain('Programtider: +1 time');
    expect(texts()).not.toContain('Arkivtid:');
    expect(tree!.root.findAllByType('TvPressable' as any)).toHaveLength(3);
  });

  it('et sent kildeopslag maa ikke montere knapper efter unmount', async () => {
    const pending = deferred<unknown[]>(); f.sources.mockReturnValue(pending.promise);
    await mount();
    expect(texts()).toContain('Henter tidsindstillinger');
    await act(async () => { tree!.unmount(); tree = null; });
    await act(async () => pending.resolve([panelA]));
    expect(f.save).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('et sent gemmesvar maa ikke melde aendring efter unmount', async () => {
    const pending = deferred<void>(); f.save.mockReturnValue(pending.promise);
    await mount(); await press('Mit panel: Programtider, +1 time');
    await act(async () => { tree!.unmount(); tree = null; });
    await act(async () => pending.resolve());
    expect(f.changed).not.toHaveBeenCalled();
  });

  it('et sent gemmesvar fra en anden database maa ikke overskrive den nye visning', async () => {
    const pending = deferred<void>(); f.save.mockReturnValueOnce(pending.promise);
    await mount(); await press('Mit panel: Programtider, +1 time');
    f.epg.mockResolvedValue(0); f.archive.mockResolvedValue(0);
    await act(async () => tree!.update(createElement(EpgTimingSettings, { db: otherDb, onChanged: f.changed })));
    await act(async () => pending.resolve());
    expect(texts()).toContain('Programtider: 0 minutter');
    expect(f.changed).not.toHaveBeenCalled();
    await press('Mit panel: Programtider, +1 time');
    expect(f.save).toHaveBeenLastCalledWith(otherDb, panelA.id, { epgMinutes: 60, archiveMinutes: 0 });
  });
});


it('v400-EPG skjuler Programtider men bevarer arkivets eksisterende knapper', async () => {
  f.epg.mockResolvedValue(0);
  await act(async () => { tree = create(createElement(EpgTimingSettings, {db, showEpg:false, onChanged:f.changed})); });
  expect(texts()).not.toContain('Programtider');
  expect(texts()).toContain('Arkivtid: +1 time');
  await press('Mit panel: Arkivtid, +1 time');
  expect(f.save).toHaveBeenLastCalledWith(db,panelA.id,{epgMinutes:0,archiveMinutes:120});
});
