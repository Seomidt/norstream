import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('../../ui/tv.js', () => ({ isTV: true }));
import { createTestDatabase } from '../../storage/testDb.js';
import { migrate } from '../../storage/schema.js';
import { createBackup, restoreBackup } from '../../storage/backup.js';
import { loadUniformAudio, saveUniformAudio } from './uniformAudio.js';
import { PREVIEW_UNIFORM_AUDIO_OPTIONS, TV_UNIFORM_AUDIO_OPTIONS } from './tvCodec.js';

it('er til som standard, husker Fra og flytter valget med en backup', async () => {
  const db = createTestDatabase(), other = createTestDatabase();
  await migrate(db); await migrate(other);
  expect(await loadUniformAudio(db)).toBe(true);
  await saveUniformAudio(db, false);
  expect(await loadUniformAudio(db)).toBe(false);
  const backup = await createBackup(db, 1000);
  expect(backup.settings.uniform_audio).toBe('0');
  await restoreBackup(other, backup);
  expect(await loadUniformAudio(other)).toBe(false);
  await saveUniformAudio(db, true);
  expect(await loadUniformAudio(db)).toBe(true);
});
it('bruger faste native profiler for preview og TV', () => {
  expect(Object.isFrozen(TV_UNIFORM_AUDIO_OPTIONS)).toBe(true);
  expect(Object.isFrozen(PREVIEW_UNIFORM_AUDIO_OPTIONS)).toBe(true);
  expect(TV_UNIFORM_AUDIO_OPTIONS.norstreamUniformAudio).toBe(true);
  expect(TV_UNIFORM_AUDIO_OPTIONS.norstreamSynchronousCodec).toBe(true);
});
