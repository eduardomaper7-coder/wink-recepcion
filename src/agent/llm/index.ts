import { env } from '@/config/env';
import { AnthropicLlm } from './anthropic';
import type { Llm } from './types';

let instance: Llm | null = null;

export function llm(): Llm {
  if (instance) return instance;
  const e = env();
  if (!e.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
  instance = new AnthropicLlm(e.ANTHROPIC_API_KEY, { fast: e.MODEL_FAST, smart: e.MODEL_SMART });
  return instance;
}

/** Permite inyectar un doble en tests de integración. */
export function setLlm(l: Llm | null) {
  instance = l;
}
