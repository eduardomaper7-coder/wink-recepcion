/**
 * Listado de pendientes: comparación DETERMINISTA entre lo recibido y la plantilla configurable
 * de documentación/información necesaria. El LLM no decide qué falta; solo redacta el correo.
 */

export interface RequiredTemplate {
  id: string;
  label: string;
  kind: 'documento' | 'dato';
  match_rule: { doc_type?: string; subtype?: string; flag?: string; min?: number; fact?: string };
  required: boolean;
  audience: 'cliente' | 'interno';
  sort: number;
}

export interface ReceivedDoc {
  id: string;
  doc_type: string;
  status: string; // ok | ilegible | duplicado | rechazado
  extracted: { subtipo?: string | null; plano?: { es_estado_actual?: boolean | null; completo?: boolean | null; legible?: boolean | null } | null };
}

export interface KnownFact {
  field: string;
  value: string;
}

export interface PendingResult {
  templateId: string;
  description: string;
  satisfied: boolean;
  resolvedByDocumentId: string | null;
  audience: 'cliente' | 'interno';
  required: boolean;
  sort: number;
  note?: string;
}

function matchesDoc(rule: RequiredTemplate['match_rule'], d: ReceivedDoc): boolean {
  if (d.status !== 'ok') return false;
  if (rule.doc_type && d.doc_type !== rule.doc_type) return false;
  if (rule.subtype && (d.extracted?.subtipo ?? '') !== rule.subtype) return false;
  if (rule.flag === 'es_estado_actual_completo') {
    const p = d.extracted?.plano;
    return !!p && p.es_estado_actual !== false && p.completo === true && p.legible !== false;
  }
  return true;
}

export function computePending(templates: RequiredTemplate[], docs: ReceivedDoc[], facts: KnownFact[]): PendingResult[] {
  return templates
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((t) => {
      const rule = t.match_rule;
      if (t.kind === 'dato' && rule.fact) {
        const ok = facts.some((f) => f.field === rule.fact && f.value.trim() !== '');
        return { templateId: t.id, description: t.label, satisfied: ok, resolvedByDocumentId: null, audience: t.audience, required: t.required, sort: t.sort };
      }
      const matching = docs.filter((d) => matchesDoc(rule, d));
      const min = rule.min ?? 1;
      const satisfied = matching.length >= min;
      let note: string | undefined;
      if (!satisfied && rule.flag === 'es_estado_actual_completo') {
        const partial = docs.find((d) => d.status === 'ok' && d.doc_type === 'plano');
        if (partial) note = 'Se ha recibido un plano, pero no está completo o no refleja el estado actual';
      }
      if (!satisfied && rule.min && matching.length > 0) note = `Recibidas ${matching.length} de ${min}`;
      const illegible = docs.find((d) => d.status === 'ilegible' && (!rule.doc_type || d.doc_type === rule.doc_type));
      if (!satisfied && illegible) note = 'Se recibió un archivo, pero no es legible';
      return {
        templateId: t.id,
        description: t.label,
        satisfied,
        resolvedByDocumentId: satisfied ? (matching[0]?.id ?? null) : null,
        audience: t.audience,
        required: t.required,
        sort: t.sort,
        note,
      };
    });
}

/** Solo lo que hay que pedir al cliente: obligatorio y no satisfecho (los opcionales se piden "si los tiene"). */
export function itemsToRequest(results: PendingResult[]): { required: PendingResult[]; optional: PendingResult[] } {
  const open = results.filter((r) => !r.satisfied && r.audience === 'cliente');
  return { required: open.filter((r) => r.required), optional: open.filter((r) => !r.required) };
}
