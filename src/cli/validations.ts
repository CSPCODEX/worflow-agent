export const validateAgentName = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length === 0) {
    return 'El nombre es obligatorio.';
  }
  if (!/^[a-z0-9-]+$/.test(value)) {
    return 'Solo letras minusculas, numeros y guiones. Ej: mi-agente';
  }
  return undefined;
};

export const validateRole = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length < 10) {
    return 'El rol es fundamental. Se mas descriptivo (minimo 10 caracteres).';
  }
  return undefined;
};

export const validateDescription = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length === 0) {
    return 'Proporciona una breve descripcion.';
  }
  return undefined;
};
