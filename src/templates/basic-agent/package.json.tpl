{
  "name": "{{AGENT_NAME}}",
  "version": "1.0.0",
  "description": "{{AGENT_DESCRIPTION}}",
  "type": "module",
  "scripts": {
    "start": "bun run index.ts"
  },
  "dependencies": {
    "@agentclientprotocol/sdk": "^0.15.0",
    "dotenv": "^16.4.5"{{PROVIDER_DEP}}
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
