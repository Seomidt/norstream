import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { uri: string; status: number } | null | undefined;
type Pending = { resolve: (value: Result) => void; reject: (error: unknown) => void };
type Task = {
  target: string;
  resumeData: string | undefined;
  progress: (value: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void;
  pending: Pending | null;
  downloadAsync: ReturnType<typeof vi.fn>;
  resumeAsync: ReturnType<typeof vi.fn>;
  pauseAsync: ReturnType<typeof vi.fn>;
  cancelAsync: ReturnType<typeof vi.fn>;
};

const f = vi.hoisted(() => ({
  files: new Map<string, number>(),
  tasks: [] as Task[],
  starts: [] as Task[],
  active: new Set<Task>(),
  peak: 0,
  holdInfo: null as null | Promise<void>,
  holdContent: null as null | Promise<void>,
  launch: vi.fn(async () => ({ resultCode: 0, extra: {} })),
  pause: null as null | ((task: Task) => Promise<unknown>),
  created: null as null | (() => void),
  platform: { OS: 'android', isTV: true },
}));

vi.mock('react-native', () => ({ Platform: f.platform }));
vi.mock('../../ui/tv.js', () => ({ isTV: true }));
vi.mock('expo-application', () => ({ nativeBuildVersion: '416' }));
vi.mock('expo-intent-launcher', () => ({ startActivityAsync: f.launch }));
vi.mock('../../diagnostics/log.js', () => ({ logEvent: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: vi.fn(async (uri: string) => {
    if (f.holdInfo !== null) await f.holdInfo;
    return f.files.has(uri) ? { exists: true, uri, size: f.files.get(uri)!, isDirectory: false } : { exists: false, uri };
  }),
  readDirectoryAsync: vi.fn(async () => [...f.files.keys()].map(path => path.split('/').at(-1)!)),
  deleteAsync: vi.fn(async (uri: string) => { f.files.delete(uri); }),
  getContentUriAsync: vi.fn(async (uri: string) => { if (f.holdContent !== null) await f.holdContent; return uri; }),
  createDownloadResumable: vi.fn((_url: string, target: string, _options: unknown, progress: Task['progress'], resumeData?: string) => {
    const start = (): Promise<Result> => {
      f.starts.push(task); f.active.add(task); f.peak = Math.max(f.peak, f.active.size);
      if (!f.files.has(target)) f.files.set(target, 0);
      return new Promise<Result>((resolve, reject) => { task.pending = { resolve, reject }; })
        .finally(() => { task.pending = null; f.active.delete(task); });
    };
    const task: Task = {
      target, progress, resumeData, pending: null,
      downloadAsync: vi.fn(start), resumeAsync: vi.fn(start),
      pauseAsync: vi.fn(async () => {
        if (f.pause !== null) return f.pause(task);
        task.pending?.resolve(null); // Androids originale download-promise.
        return { resumeData: String(f.files.get(target) ?? 0) };
      }),
      cancelAsync: vi.fn(async () => { task.pending?.resolve(null); }),
    };
    f.tasks.push(task);
    f.created?.();
    return task;
  }),
}));

let api: typeof import('./appUpdate.js');
const info = (versionCode = 417, size: number | null = 100) => ({ versionCode, size, url: `https://example.invalid/${versionCode}.apk` });
const path = (versionCode = 417) => `file:///cache/norstream-${versionCode}.apk`;
async function flush(): Promise<void> { for (let i = 0; i < 35; i++) await Promise.resolve(); }
function progress(task: Task, written: number): void {
  f.files.set(task.target, written);
  task.progress({ totalBytesWritten: written, totalBytesExpectedToWrite: 100 });
}
function finish(task: Task, status = 200, size = 100): void {
  progress(task, size);
  task.pending!.resolve({ uri: task.target, status });
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(0);
  f.files.clear(); f.tasks.length = 0; f.starts.length = 0; f.active.clear(); f.peak = 0;
  f.holdInfo = null; f.holdContent = null; f.pause = null; f.created = null; f.platform.OS = 'android'; f.launch.mockClear();
  api = await import('./appUpdate.js');
});
afterEach(() => {
  try { expect(vi.getTimerCount()).toBe(0); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); }
});

describe('APK-download giver afspilningen nettet', () => {
  it('udskyder netvaerk til den sidste idempotente pause er frigivet', async () => {
    const releaseA = api.pauseApkDownloads(); const releaseB = api.pauseApkDownloads();
    const result = api.downloadApk(info());
    await flush(); vi.advanceTimersByTime(120_000); await flush();
    expect(f.starts).toHaveLength(0);
    releaseA(); releaseA(); await flush(); expect(f.starts).toHaveLength(0);
    releaseB(); await flush(); expect(f.starts).toHaveLength(1);
    finish(f.tasks[0]!); await expect(result).resolves.toBe(path());
  });

  it('respekterer en pause der kommer mens det indledende cacheopslag venter', async () => {
    let releaseInfo!: () => void;
    f.holdInfo = new Promise(resolve => { releaseInfo = resolve; });
    const result = api.downloadApk(info()); await flush();
    const release = api.pauseApkDownloads(); releaseInfo(); f.holdInfo = null; await flush();
    expect(f.starts).toHaveLength(0);
    release(); await flush(); finish(f.tasks[0]!);
    await expect(result).resolves.toBe(path());
  });

  it('pauser en aktiv download og genoptager via HTTP206 uden dobbelt download', async () => {
    const result = api.downloadApk(info());
    expect(api.downloadApk(info())).toBe(result);
    await flush(); const first = f.tasks[0]!; progress(first, 35);
    const release = api.pauseApkDownloads(); await flush();
    expect(first.pauseAsync).toHaveBeenCalledTimes(1);
    expect(f.starts).toHaveLength(1);
    vi.advanceTimersByTime(180_000); await flush();
    expect(first.cancelAsync).not.toHaveBeenCalled();
    expect(api.downloadApk(info())).toBe(result);
    release(); await flush();
    const resumed = f.tasks[1]!;
    expect(resumed.resumeData).toBe('35'); expect(resumed.resumeAsync).toHaveBeenCalledTimes(1);
    finish(resumed, 206); await expect(result).resolves.toBe(path());
    expect(f.peak).toBe(1);
  });

  it('venter paa baade pause og gammel native afslutning og bruger det sidste write som resume-offset', async () => {
    let paused!: () => void;
    f.pause = () => new Promise(resolve => { paused = () => resolve({ resumeData: '30' }); });
    const result = api.downloadApk(info()); await flush();
    const first = f.tasks[0]!; progress(first, 30);
    const release = api.pauseApkDownloads(); release(); await flush();
    paused(); await flush(); expect(f.starts).toHaveLength(1);
    progress(first, 34); first.pending!.resolve(null); await flush();
    expect(f.starts).toHaveLength(2); expect(f.tasks[1]!.resumeData).toBe('34');
    finish(f.tasks[1]!, 206); await expect(result).resolves.toBe(path());
    expect(f.peak).toBe(1);
  });

  it('bevarer en hel fil der afsluttes mens en pause er paa vej', async () => {
    let paused!: () => void;
    f.pause = () => new Promise(resolve => { paused = () => resolve({ resumeData: '100' }); });
    const result = api.downloadApk(info()); await flush();
    const release = api.pauseApkDownloads(); finish(f.tasks[0]!); await flush();
    paused(); await flush();
    await expect(result).resolves.toBe(path()); release(); await flush();
    expect(f.starts).toHaveLength(1);
    await expect(api.downloadApk(info())).resolves.toBe(path());
    expect(f.starts).toHaveLength(1);
  });

  it('en ny pause mellem waiter-resolve og native resume starter intet netvaerk', async () => {
    const result = api.downloadApk(info()); await flush(); progress(f.tasks[0]!, 30);
    const releaseA = api.pauseApkDownloads(); await flush();
    let releaseB!: () => void;
    releaseA(); queueMicrotask(() => { releaseB = api.pauseApkDownloads(); }); await flush();
    expect(f.starts).toHaveLength(1);
    releaseB(); await flush(); finish(f.tasks[1]!, 206);
    await expect(result).resolves.toBe(path());
  });

  it('en pause i microtasken efter task-konstruktion forhindrer foerste native start', async () => {
    let release!: () => void;
    f.created = () => {
      f.created = null;
      void Promise.resolve().then(() => { release = api.pauseApkDownloads(); });
    };
    const result = api.downloadApk(info()); await flush();
    expect(f.tasks).toHaveLength(1); expect(f.starts).toHaveLength(0);
    release(); await flush(); finish(f.tasks[0]!);
    await expect(result).resolves.toBe(path());
  });

  it('genstarter rent efter afvist native pause og venter stadig paa frigivelsen', async () => {
    f.pause = async () => { throw new Error('No download object available'); };
    const result = api.downloadApk(info()); await flush(); progress(f.tasks[0]!, 30);
    const release = api.pauseApkDownloads(); await flush();
    expect(f.tasks[0]!.cancelAsync).toHaveBeenCalledTimes(1); expect(f.starts).toHaveLength(1);
    release(); await flush();
    const restarted = f.tasks[1]!;
    expect(restarted.resumeData).toBeUndefined(); expect(restarted.downloadAsync).toHaveBeenCalledTimes(1);
    finish(restarted); await expect(result).resolves.toBe(path());
  });

  it('taeller kun aktive sekunder i 45-sekunders stopvagten', async () => {
    const result = api.downloadApk(info()); const rejection = expect(result).rejects.toThrow('Hentningen gik i stå');
    await flush(); vi.advanceTimersByTime(20_000);
    const release = api.pauseApkDownloads(); await flush();
    vi.advanceTimersByTime(300_000); await flush(); release(); await flush();
    const resumed = f.tasks[1]!;
    vi.advanceTimersByTime(20_000); await flush(); expect(resumed.cancelAsync).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000); await flush();
    expect(resumed.cancelAsync).toHaveBeenCalledTimes(1); await rejection;
  });

  it('koerer forskellige udgaver i raekke og genbruger en koesat udgave', async () => {
    const first = api.downloadApk(info(417)); const second = api.downloadApk(info(418));
    expect(api.downloadApk(info(417))).toBe(first); expect(api.downloadApk(info(418))).toBe(second);
    await flush(); expect(f.starts).toHaveLength(1);
    finish(f.tasks[0]!); await expect(first).resolves.toBe(path(417)); await flush();
    expect(f.starts).toHaveLength(2); expect(f.files.has(path(417))).toBe(false);
    finish(f.tasks[1]!); await expect(second).resolves.toBe(path(418)); expect(f.peak).toBe(1);
  });

  it('en fejl i en udgave blokerer ikke den naeste koesatte download', async () => {
    const first = api.downloadApk(info(417)); const failure = expect(first).rejects.toThrow('APK’en kunne ikke hentes');
    const second = api.downloadApk(info(418)); await flush();
    f.tasks[0]!.pending!.reject(new Error('offline')); await failure; await flush();
    finish(f.tasks[1]!); await expect(second).resolves.toBe(path(418));
  });

  it('en allerede komplet APK kraever intet netvaerk under pause', async () => {
    f.files.set(path(), 100); const release = api.pauseApkDownloads();
    await expect(api.downloadApk(info())).resolves.toBe(path()); release();
    expect(f.tasks).toHaveLength(0);
  });

  it('ignoreret Range paa Android genstarter rent, ogsaa naar APK-stoerrelsen er ukendt', async () => {
    const result = api.downloadApk(info(417, null)); await flush(); progress(f.tasks[0]!, 30);
    const release = api.pauseApkDownloads(); await flush(); release(); await flush();
    finish(f.tasks[1]!, 200, 130); await flush();
    expect(f.starts).toHaveLength(3); expect(f.tasks[2]!.downloadAsync).toHaveBeenCalledTimes(1);
    expect(f.files.get(path())).toBe(0);
    finish(f.tasks[2]!); await expect(result).resolves.toBe(path()); expect(f.peak).toBe(1);
  });

  it('bevarer iOS-opgavens opaque resume-data', async () => {
    f.platform.OS = 'ios';
    const result = api.downloadApk(info()); await flush(); progress(f.tasks[0]!, 30);
    const release = api.pauseApkDownloads(); await flush(); release(); await flush();
    expect(f.tasks).toHaveLength(1); expect(f.tasks[0]!.resumeAsync).toHaveBeenCalledTimes(1);
    finish(f.tasks[0]!, 206); await expect(result).resolves.toBe(path());
  });

  it('installerer aldrig en komplet cachefil mens afspilning holder pause-leasen', async () => {
    f.files.set(path(), 100); const release = api.pauseApkDownloads();
    await expect(api.downloadAndInstall(info())).rejects.toThrow('Afslut afspilningen');
    expect(f.starts).toHaveLength(0); expect(f.launch).not.toHaveBeenCalled(); release();
  });

  it('installerer heller ikke naar afspilning starter under content-URI-opslaget', async () => {
    let contentReady!: () => void;
    f.holdContent = new Promise(resolve => { contentReady = resolve; });
    const result = api.installApk(path()); const rejected = expect(result).rejects.toThrow('Afslut afspilningen');
    await flush(); const release = api.pauseApkDownloads(); contentReady();
    await rejected; expect(f.launch).not.toHaveBeenCalled(); release();
  });
});
