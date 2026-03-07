import { intro, outro, spinner, note, cancel } from '@clack/prompts';
import pc from 'picocolors';

export const logger = {
  welcome: (appName: string) => {
    console.clear();
    intro(pc.bgCyan(pc.black(` 🤖 Bienvenido al Generador de Agentes Gemini: ${appName} `)));
  },

  success: (message: string) => {
    outro(pc.green(`🎉 ${message}`));
  },

  error: (message: string) => {
    cancel(pc.red(`❌ Error: ${message}`));
    process.exit(1);
  },

  info: (title: string, message: string) => {
    note(message, pc.blue(title));
  },

  createSpinner: () => {
    const s = spinner();
    return {
      start: (msg: string) => s.start(pc.cyan(msg)),
      stop: (msg: string) => s.stop(pc.green(`✔ ${msg}`)),
      fail: (msg: string) => s.stop(pc.red(`✖ ${msg}`)),
    };
  }
};
