export const validateAgentName = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length === 0) {
    return 'El nombre es obligatorio.';
  }
  if (!/^[a-z0-9-]+$/.test(value)) {
    return 'Usa sólo letras minúsculas, números y guiones (ej. mi-agente).';
  }
  return undefined;
};

export const validateRole = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length < 10) {
    return 'El rol es fundamental para Gemini. Sé más descriptivo (mínimo 10 caracteres).';
  }
  return undefined;
};

export const validateDescription = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length === 0) {
    return 'Proporciona una breve descripción.';
  }
  return undefined;
};
