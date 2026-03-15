import type { PipelineSnapshot, SnapshotCallback, MonitorConfig } from './types';
import { buildSnapshot } from './aggregator';

const DEFAULT_POLL_MS = 30_000;

export class PipelinePoller {
  private readonly docsDir: string;
  private readonly intervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cachedSnapshot: PipelineSnapshot | null = null;
  private callbacks: SnapshotCallback[] = [];

  constructor(config: MonitorConfig) {
    this.docsDir = config.docsDir;
    this.intervalMs = config.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  // Arranca el poller. Hace un scan inmediato y luego en intervalos.
  start(): void {
    if (this.intervalId !== null) return; // ya iniciado
    this.scan();
    this.intervalId = setInterval(() => this.scan(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Fuerza un scan inmediato (para uso del handler IPC "refresh")
  forceRefresh(): PipelineSnapshot {
    this.scan();
    return this.cachedSnapshot!;
  }

  // Retorna el ultimo snapshot sin relanzar el scan
  getSnapshot(): PipelineSnapshot {
    if (!this.cachedSnapshot) {
      this.scan();
    }
    return this.cachedSnapshot!;
  }

  onSnapshot(cb: SnapshotCallback): void {
    this.callbacks.push(cb);
  }

  private scan(): void {
    try {
      const snapshot = buildSnapshot(this.docsDir);
      this.cachedSnapshot = snapshot;
      for (const cb of this.callbacks) {
        cb(snapshot);
      }
    } catch (e: any) {
      console.error('[monitor/poller] scan error:', e.message);
    }
  }
}
