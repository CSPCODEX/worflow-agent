export interface ChatHandle {
  cleanup: () => void;
}

export function renderChat(container: HTMLElement, agentName: string): ChatHandle {
  container.innerHTML = `
    <div class="chat-view">
      <div class="chat-header">
        ${escapeHtml(agentName)}
        <div class="agent-status" id="chat-status">Conectando...</div>
      </div>
      <div class="chat-connecting" id="chat-connecting">
        <div class="spinner"></div>
        <span>Iniciando sesión ACP...</span>
      </div>
      <div class="chat-messages" id="chat-messages" style="display:none"></div>
      <div class="chat-input-area" id="chat-input-area" style="display:none">
        <textarea id="chat-input" placeholder="Escribe un mensaje..." rows="1"></textarea>
        <button id="chat-send" disabled>Enviar</button>
      </div>
    </div>
  `;

  const statusEl = container.querySelector<HTMLElement>('#chat-status')!;
  const connectingEl = container.querySelector<HTMLElement>('#chat-connecting')!;
  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!;
  const inputAreaEl = container.querySelector<HTMLElement>('#chat-input-area')!;
  const inputEl = container.querySelector<HTMLTextAreaElement>('#chat-input')!;
  const sendBtn = container.querySelector<HTMLButtonElement>('#chat-send')!;

  const rpc = (window as any).appRpc;
  let sessionId: string | null = null;
  let currentAgentMsgEl: HTMLElement | null = null;
  let isWaiting = false;
  let responseTimeout: ReturnType<typeof setTimeout> | null = null;
  const RESPONSE_TIMEOUT_MS = 90_000;

  async function connect() {
    try {
      const result = await rpc.request.createSession({ agentName });
      if (!result.success || !result.sessionId) {
        statusEl.textContent = `Error: ${result.error || 'No se pudo conectar'}`;
        connectingEl.innerHTML = `<span style="color:#d46a6a">Error al conectar: ${escapeHtml(result.error || 'Desconocido')}</span>`;
        return;
      }
      sessionId = result.sessionId;
      statusEl.textContent = 'Conectado';
      connectingEl.style.display = 'none';
      messagesEl.style.display = 'flex';
      inputAreaEl.style.display = 'flex';
      sendBtn.disabled = false;
      inputEl.focus();
    } catch (e: any) {
      statusEl.textContent = 'Error de conexión';
      connectingEl.innerHTML = `<span style="color:#d46a6a">${escapeHtml(e.message)}</span>`;
    }
  }

  async function sendMessage() {
    if (!sessionId || isWaiting) return;
    const text = inputEl.value.trim();
    if (!text) return;

    isWaiting = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    appendMessage('user', text);
    currentAgentMsgEl = appendMessage('agent', '', true);

    responseTimeout = setTimeout(() => {
      if (currentAgentMsgEl) {
        currentAgentMsgEl.textContent = '[Timeout] El agente no respondió a tiempo.';
        currentAgentMsgEl.classList.remove('streaming');
        currentAgentMsgEl = null;
      }
      isWaiting = false;
      sendBtn.disabled = false;
    }, RESPONSE_TIMEOUT_MS);

    try {
      await rpc.request.sendMessage({ sessionId, message: text });
    } catch (e: any) {
      if (responseTimeout) { clearTimeout(responseTimeout); responseTimeout = null; }
      if (currentAgentMsgEl) {
        currentAgentMsgEl.textContent = `[Error] ${e.message}`;
        currentAgentMsgEl.classList.remove('streaming');
      }
      isWaiting = false;
      sendBtn.disabled = false;
    }
  }

  function appendMessage(role: 'user' | 'agent', text: string, streaming = false): HTMLElement {
    const msg = document.createElement('div');
    msg.className = `chat-message ${role}`;
    const contentEl = document.createElement('div');
    contentEl.className = `message-content${streaming ? ' streaming' : ''}`;
    contentEl.textContent = text;
    msg.appendChild(contentEl);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return contentEl;
  }

  // ACP streaming events from app.ts
  function onChunk(e: Event) {
    const { sessionId: sid, text } = (e as CustomEvent).detail;
    if (sid !== sessionId || !currentAgentMsgEl) return;
    currentAgentMsgEl.textContent += text;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function onEnd(e: Event) {
    const { sessionId: sid } = (e as CustomEvent).detail;
    if (sid !== sessionId || !currentAgentMsgEl) return;
    if (responseTimeout) { clearTimeout(responseTimeout); responseTimeout = null; }
    currentAgentMsgEl.classList.remove('streaming');
    currentAgentMsgEl = null;
    isWaiting = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  function onError(e: Event) {
    const { sessionId: sid, error } = (e as CustomEvent).detail;
    if (sid !== sessionId || !currentAgentMsgEl) return;
    if (responseTimeout) { clearTimeout(responseTimeout); responseTimeout = null; }
    currentAgentMsgEl.textContent = `[Error] ${error}`;
    currentAgentMsgEl.classList.remove('streaming');
    currentAgentMsgEl = null;
    isWaiting = false;
    sendBtn.disabled = false;
  }

  document.addEventListener('agent:chunk', onChunk);
  document.addEventListener('agent:end', onEnd);
  document.addEventListener('agent:error', onError);

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  connect();

  return {
    cleanup() {
      if (responseTimeout) clearTimeout(responseTimeout);
      document.removeEventListener('agent:chunk', onChunk);
      document.removeEventListener('agent:end', onEnd);
      document.removeEventListener('agent:error', onError);
      if (sessionId) rpc.request.closeSession({ sessionId }).catch(() => {});
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
