// Re-exporta la vista del monitor para uso desde el renderer.
// El archivo real vive en src/dev-tools/monitor/ui/monitor-view.ts para mantener
// el modulo autocontenido y extraible.
export { renderMonitor, type MonitorViewHandle } from '../../dev-tools/monitor/ui/monitor-view';
