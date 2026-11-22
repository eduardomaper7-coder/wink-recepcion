import type { z } from 'zod';

export type ModelTier = 'fast' | 'smart';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'pdf'; data: Buffer; title?: string }
  | { type: 'image'; data: Buffer; mime: string };

export interface LlmTask<T> {
  /** Nombre lógico de la tarea (para trazas y para los dobles de test) */
  task: string;
  tier: ModelTier;
  system: string;
  content: ContentPart[];
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface LlmResult<T> {
  data: T;
  model: string;
  usage: { input: number; output: number };
}

export interface Llm {
  run<T>(task: LlmTask<T>): Promise<LlmResult<T>>;
}
