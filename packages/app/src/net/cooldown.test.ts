import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { COOLDOWN_MS, PanelCoolingDownError, clearCooldowns, cooldownUntil, withPanelCooldown } from './cooldown.js';

const respond = (status: number): FetchLike =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => ({}), text: async () => '' })) as unknown as FetchLike;

beforeEach(() => clearCooldowns());

describe('withPanelCooldown', () => {
  // Ét 403 slettede foer kilden, favoritterne og adgangsoplysningerne.
  it('giver vaerten fred efter et 403, og sender intet imens', async () => {
    const underlying = respond(403);
    const fetchImpl = withPanelCooldown(underlying);
    await fetchImpl('http://panel.example:8080/player_api.php?username=u&password=p');
    expect(cooldownUntil('http://panel.example:8080')).not.toBeNull();

    await expect(fetchImpl('http://panel.example:8080/player_api.php')).rejects.toBeInstanceOf(
      PanelCoolingDownError,
    );
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it('lader andre vaerter vaere', async () => {
    const underlying = respond(403);
    const fetchImpl = withPanelCooldown(underlying);
    await fetchImpl('http://panel.example:8080/player_api.php');
    await expect(fetchImpl('https://raw.githubusercontent.com/x')).resolves.toBeDefined();
  });

  it('sender kalderens hoveder videre (fx User-Agent til nyheds-RSS)', async () => {
    const underlying = respond(200);
    const fetchImpl = withPanelCooldown(underlying);
    await fetchImpl('https://www.dr.dk/feeds/alle', { 'User-Agent': 'NorStream' });
    expect(underlying).toHaveBeenCalledWith('https://www.dr.dk/feeds/alle', { 'User-Agent': 'NorStream' });
  });

  it('slipper vaerten igen naar tiden er gaaet', async () => {
    const fetchImpl = withPanelCooldown(respond(403));
    const start = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    await fetchImpl('http://panel.example:8080/player_api.php');
    vi.spyOn(Date, 'now').mockReturnValue(start + COOLDOWN_MS + 1);
    await expect(fetchImpl('http://panel.example:8080/player_api.php')).resolves.toBeDefined();
    vi.restoreAllMocks();
  });

  it('roerer ikke et svar der ikke er en afvisning', async () => {
    const fetchImpl = withPanelCooldown(respond(500));
    await fetchImpl('http://panel.example:8080/player_api.php');
    expect(cooldownUntil('http://panel.example:8080')).toBeNull();
  });
});
