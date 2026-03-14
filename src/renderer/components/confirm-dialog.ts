export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function showConfirmDialog(options: ConfirmDialogOptions): void {
  const { title, message, confirmLabel = 'Eliminar', cancelLabel = 'Cancelar', onConfirm, onCancel } = options;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-dialog-overlay';

  overlay.innerHTML = `
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <h3 id="cd-title" class="confirm-dialog-title"></h3>
      <p class="confirm-dialog-message"></p>
      <div class="confirm-dialog-actions">
        <button id="cd-cancel" class="btn-secondary"></button>
        <button id="cd-confirm" class="btn-danger"></button>
      </div>
    </div>
  `;

  // Usar textContent para evitar XSS
  overlay.querySelector<HTMLElement>('.confirm-dialog-title')!.textContent = title;
  overlay.querySelector<HTMLElement>('.confirm-dialog-message')!.textContent = message;
  overlay.querySelector<HTMLButtonElement>('#cd-cancel')!.textContent = cancelLabel;
  overlay.querySelector<HTMLButtonElement>('#cd-confirm')!.textContent = confirmLabel;

  function close() {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  }

  function handleConfirm() { close(); onConfirm(); }
  function handleCancel() { close(); onCancel?.(); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleCancel();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handleCancel();
  });

  overlay.querySelector('#cd-cancel')!.addEventListener('click', handleCancel);
  overlay.querySelector('#cd-confirm')!.addEventListener('click', handleConfirm);
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('#cd-confirm')!.focus();
}
