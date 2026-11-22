import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ContentPart, Llm, LlmResult, LlmTask } from './types';
import { log } from '@/lib/log';

type Block = Anthropic.Messages.ContentBlockParam;

function toBlocks(parts: ContentPart[]): Block[] {
  return parts.map((p): Block => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    if (p.type === 'pdf')
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data.toString('base64') }, ...(p.title ? { title: p.title } : {}) };
    return {
      type: 'image',
      source: { type: 'base64', media_type: p.mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: p.data.toString('base64') },
    };
  });
}

/** Palabras clave de JSON Schema que la salida estructurada no admite: se pasan a la descripción. */
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format', '$schema'];

/** Adapta el JSON Schema de Zod al subconjunto que acepta output_config.format. */
export function toStructuredSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStructuredSchema);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    if (UNSUPPORTED.includes(k)) {
      if (k !== '$schema') notes.push(`${k}: ${JSON.stringify(v)}`);
      continue;
    }
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, toStructuredSchema(pv)]))
      : toStructuredSchema(v);
  }
  // La API limita a 16 los parámetros con uniones: los textos opcionales se piden como "" y se restauran a null al recibirlos.
  if (Array.isArray(out.type) && out.type.length === 2 && out.type.includes('string') && out.type.includes('null')) {
    out.type = 'string';
    notes.push('cadena vacía "" si no consta');
  }
  if (notes.length) out.description = [src.description, `(${notes.join(', ')})`].filter(Boolean).join(' ');
  if (out.type === 'object' || out.properties) {
    out.additionalProperties = false;
    if (out.properties) out.required = Object.keys(out.properties as object);
  }
  return out;
}

function rawJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
}

/** Deshace la conversión de toStructuredSchema: "" → null donde el esquema original admitía null en un texto. */
export function restoreNulls(data: unknown, node: unknown): unknown {
  if (!node || typeof node !== 'object') return data;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.type) && n.type.includes('string') && n.type.includes('null') && data === '') return null;
  if (Array.isArray(n.anyOf)) {
    if (data === null) return null;
    const branch = (n.anyOf as Record<string, unknown>[]).find((b) => b.type !== 'null');
    return restoreNulls(data, branch);
  }
  if (Array.isArray(data) && n.items) return data.map((d) => restoreNulls(d, n.items));
  if (data && typeof data === 'object' && !Array.isArray(data) && n.properties) {
    const props = n.properties as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, k in props ? restoreNulls(v, props[k]) : v]));
  }
  return data;
}

/**
 * Cliente de Claude con salida estructurada (output_config.format = json_schema).
 * La respuesta llega como JSON en el bloque de texto; se valida con Zod y, si no cumple,
 * se reintenta una vez explicando el error.
 */
export class AnthropicLlm implements Llm {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: { fast: string; smart: string },
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  async run<T>(task: LlmTask<T>): Promise<LlmResult<T>> {
    const model = this.models[task.tier];
    const raw = rawJsonSchema(task.schema);
    const schema = toStructuredSchema(raw) as Record<string, unknown>;
    const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: toBlocks(task.content) }];
    let usage = { input: 0, output: 0 };
    let maxTokens = task.maxTokens ?? 4096;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: `${task.system}\n\nTarea: ${task.toolDescription}. Responde únicamente con el JSON del esquema indicado.`,
        messages,
        output_config: { format: { type: 'json_schema', schema } },
      } as Anthropic.Messages.MessageCreateParamsNonStreaming);
      usage = { input: usage.input + res.usage.input_tokens, output: usage.output + res.usage.output_tokens };

      if (res.stop_reason === 'max_tokens') {
        log.warn(`[${task.task}] respuesta cortada por max_tokens, reintentando con más margen`);
        maxTokens = Math.min(maxTokens * 2, 16000);
        continue;
      }
      if (res.stop_reason === 'refusal') throw new Error(`[${task.task}] el modelo rechazó la petición`);

      const text = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const parsed = task.schema.safeParse(restoreNulls(json, raw));
      if (parsed.success) return { data: parsed.data, model, usage };

      const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      log.warn(`[${task.task}] salida fuera de esquema, reintentando`, { issues });
      messages.push({ role: 'assistant', content: text || '{}' });
      messages.push({ role: 'user', content: `La respuesta no cumple el esquema: ${issues}. Devuelve de nuevo el JSON completo corregido.` });
    }
    throw new Error(`[${task.task}] salida del modelo no válida tras reintentos`);
  }
}
