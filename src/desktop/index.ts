import { BrowserWindow, PATHS } from 'electrobun/bun';
import path from 'path';
import { existsSync } from 'fs';
import { createRpc } from '../ipc/handlers';
import { acpManager } from '../ipc/acpManager';
import { initDatabase } from '../db/database';

try {
  initDatabase();
} catch (e: any) {
  const detail = process.env.NODE_ENV !== 'production' ? `: ${e.message}` : '';
  console.error(`[Worflow Agent] No se pudo inicializar la base de datos${detail}`);
  process.exit(1);
}

const rpc = createRpc();

// Close all ACP sessions when the app exits
process.on('exit', () => acpManager.closeAll());
process.on('SIGINT', () => { acpManager.closeAll(); process.exit(0); });

// PATHS.VIEWS_FOLDER is correct when running as a packaged binary.
// In electrobun dev mode, fall back to the build output folder if VIEWS_FOLDER doesn't exist.
const packedViewPath = path.join(PATHS.VIEWS_FOLDER, 'main', 'index.html');
const devViewPath = path.join(process.cwd(), '..', 'Resources', 'app', 'views', 'main', 'index.html');
const resolvedViewPath = existsSync(packedViewPath) ? packedViewPath : devViewPath;
const viewUrl = `file:///${resolvedViewPath.replace(/\\/g, '/')}`;

console.log('Worflow Agent desktop starting. View:', viewUrl);

const win = new BrowserWindow({
  title: 'Worflow Agent',
  frame: { x: 100, y: 100, width: 1920, height: 1080 },
  url: viewUrl,
  rpc,
  titleBarStyle: 'default',
  transparent: false,
});

console.log('Worflow Agent desktop started.');

if (process.env.NODE_ENV === 'production') {
  win.webview.closeDevTools();
}
