import type { PipelineSnapshot, SnapshotCallback, MonitorConfig } from './types';
import { buildSnapshot } from './aggregator';
import { initHistoryDb, getHistoryDb } from './historyDb';
import { detectChanges } from './changeDetector';
import { persistChanges, loadLastKnownStates } from './historyRepository';

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

    if (config.historyDbPath) {
      try {
        initHistoryDb(config.historyDbPath);
      } catch (e: any) {
        console.error('[monitor/poller] history DB init failed, history disabled:', e.message);
        // No relanzar — degradacion graceful, el poller sigue funcionando sin historial
      }
    }
  }

  // Arranca el poller. Hace un scan inmediato y luego en intervalos.
  start(): void {
    if (this.intervalId !== null) return; // ya iniciado

    // Seedear cachedSnapshot desde la DB antes del primer scan.
    // Esto evita que detectChanges(null, snapshot) genere eventos duplicados
    // al comparar contra un estado previo inexistente en memoria.
    // Si la DB esta vacia (primer arranque real), features y bugs quedan vacios
    // - mismo comportamiento que cachedSnapshot = null, sin regresion.
    const histDb = getHistoryDb();
    if (histDb && this.cachedSnapshot === null) {
      try {
        const seeded = loadLastKnownStates(histDb);
        if (seeded.features.length > 0 || seeded.bugs.length > 0) {
          this.cachedSnapshot = {
            features: seeded.features,
            bugs: seeded.bugs,
            agentSummaries: [],
            lastUpdatedAt: new Date().toISOString(),
            parseErrors: [],
          };
        }
      } catch (e: any) {
        console.error('[monitor/poller] failed to seed snapshot from DB, proceeding cold:', e.message);
        // No relanzar - degradacion graceful, el primer scan genera eventos de bootstrap
      }
    }

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

      // NUEVO: detectar y persistir cambios ANTES de actualizar cachedSnapshot
      const histDb = getHistoryDb();
      if (histDb) {
        try {
          const changes = detectChanges(this.cachedSnapshot, snapshot);
          if (changes.events.length > 0 || changes.newMetrics.length > 0) {
            persistChanges(histDb, changes);
          }
        } catch (e: any) {
          console.error('[monitor/poller] history persist error:', e.message);
          // No relanzar — el poller sigue aunque falle el historial
        }
      }

      this.cachedSnapshot = snapshot;
      for (const cb of this.callbacks) {
        cb(snapshot);
      }
    } catch (e: any) {
      console.error('[monitor/poller] scan error:', e.message);
    }
  }
}
