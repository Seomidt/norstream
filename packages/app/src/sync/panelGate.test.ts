import { beforeEach, describe, expect, it } from 'vitest';
import { panelQueue, pauseBackgroundPanel, resetPanelGate, withPanel } from './panelGate.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('panelGate', () => {
  beforeEach(() => resetPanelGate());

  it('koerer ét kald ad gangen', async () => {
    const first = deferred();
    const order: string[] = [];
    const a = withPanel(false, async () => {
      order.push('a start');
      await first.promise;
      order.push('a slut');
    });
    const b = withPanel(false, async () => {
      order.push('b start');
    });
    await Promise.resolve();
    expect(order).toEqual(['a start']);
    expect(panelQueue()).toEqual({ foreground: 1, background: 0, busy: true });
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a start', 'a slut', 'b start']);
    expect(panelQueue().busy).toBe(false);
  });

  it('forgrunden gaar foer baggrunden, ogsaa naar baggrunden kom foerst', async () => {
    const first = deferred();
    const order: string[] = [];
    const running = withPanel(true, async () => {
      await first.promise;
    });
    const bg = withPanel(true, async () => {
      order.push('baggrund');
    });
    const fg = withPanel(false, async () => {
      order.push('forgrund');
    });
    await Promise.resolve();
    expect(panelQueue()).toEqual({ foreground: 1, background: 1, busy: true });
    first.resolve();
    await Promise.all([running, bg, fg]);
    expect(order).toEqual(['forgrund', 'baggrund']);
  });

  it('slipper koeen naar arbejdet fejler', async () => {
    await expect(withPanel(false, async () => Promise.reject(new Error('nej')))).rejects.toThrow('nej');
    expect(panelQueue().busy).toBe(false);
    let ran = false;
    await withPanel(true, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('venter med baggrund under flere afspillere, men tillader forgrund og genoptager én gang', async () => {
    const releaseOne = pauseBackgroundPanel();
    const releaseTwo = pauseBackgroundPanel();
    const order: string[] = [];
    const bg = withPanel(true, async () => { order.push('baggrund'); });
    await withPanel(false, async () => { order.push('forgrund'); });
    expect(order).toEqual(['forgrund']);
    expect(panelQueue()).toEqual({ foreground: 0, background: 1, busy: false });
    releaseOne(); releaseOne();
    await Promise.resolve();
    expect(order).toEqual(['forgrund']);
    releaseTwo(); await bg;
    expect(order).toEqual(['forgrund', 'baggrund']);
    expect(panelQueue().busy).toBe(false);
  });

  it('lader et startet kald afslutte og holder den naeste baggrund tilbage indtil resume', async () => {
    const first = deferred();
    const order: string[] = [];
    const running = withPanel(true, async () => { order.push('foerste'); await first.promise; });
    await Promise.resolve();
    const release = pauseBackgroundPanel();
    const bg = withPanel(true, async () => { order.push('naeste'); });
    const fg = withPanel(false, async () => { order.push('synlig'); });
    first.resolve(); await Promise.all([running, fg]);
    expect(order).toEqual(['foerste', 'synlig']);
    expect(panelQueue().busy).toBe(false);
    release(); await bg;
    expect(order).toEqual(['foerste', 'synlig', 'naeste']);
  });
});
