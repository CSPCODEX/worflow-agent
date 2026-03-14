import { describe, it, expect } from 'bun:test';
import {
  validateAgentName,
  validateRole,
  validateDescription,
} from '../../src/cli/validations';

describe('validateAgentName', () => {
  it('retorna error si el nombre esta vacio', () => {
    expect(validateAgentName('')).toBeDefined();
    expect(validateAgentName(undefined as any)).toBeDefined();
  });

  it('retorna error si contiene caracteres invalidos', () => {
    expect(validateAgentName('Mi Agente')).toBeDefined();   // espacio
    expect(validateAgentName('Mi-Agente')).toBeDefined();   // mayusculas
    expect(validateAgentName('agente!')).toBeDefined();     // caracter especial
  });

  it('retorna undefined para nombres validos', () => {
    expect(validateAgentName('mi-agente')).toBeUndefined();
    expect(validateAgentName('agente1')).toBeUndefined();
    expect(validateAgentName('a')).toBeUndefined();
    expect(validateAgentName('my-agent-123')).toBeUndefined();
  });

  it('retorna error si solo hay espacios', () => {
    expect(validateAgentName('   ')).toBeDefined();
  });
});

describe('validateRole', () => {
  it('retorna error si el rol esta vacio', () => {
    expect(validateRole('')).toBeDefined();
    expect(validateRole(undefined as any)).toBeDefined();
  });

  it('retorna error si el rol tiene menos de 10 caracteres', () => {
    expect(validateRole('corto')).toBeDefined();
    expect(validateRole('123456789')).toBeDefined();
  });

  it('retorna undefined para roles validos', () => {
    expect(validateRole('Eres un agente util')).toBeUndefined();
    expect(validateRole('1234567890')).toBeUndefined();
  });
});

describe('validateDescription', () => {
  it('retorna error si la descripcion esta vacia', () => {
    expect(validateDescription('')).toBeDefined();
    expect(validateDescription(undefined as any)).toBeDefined();
  });

  it('retorna undefined para descripciones validas', () => {
    expect(validateDescription('Un agente de prueba')).toBeUndefined();
    expect(validateDescription('x')).toBeUndefined();
  });

  it('retorna error si solo hay espacios', () => {
    expect(validateDescription('   ')).toBeDefined();
  });
});
