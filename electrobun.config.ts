import type { ElectrobunConfig } from 'electrobun/bun';

export default {
  app: {
    name: 'Worflow Agent',
    identifier: 'dev.worflow.agent',
    version: '1.0.0',
    description: 'Desktop GUI for managing and chatting with ACP agents',
  },
  build: {
    bun: {
      entrypoint: 'src/desktop/index.ts',
      define: {
        'process.env.NODE_ENV': '"production"',
      },
    },
    views: {
      main: {
        entrypoint: 'src/renderer/app.ts',
      },
    },
    copy: {
      'src/renderer/index.html': 'views/main/index.html',
      'src/renderer/style.css': 'views/main/style.css',
      'src/dev-tools/monitor/ui/monitor-styles.css': 'views/main/monitor-styles.css',
    },
    buildFolder: 'build',
    artifactFolder: 'artifacts',
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
