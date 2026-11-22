/**
 * Guardarraíl para correos al cliente. Regla de Wink: nunca dar precios, viabilidad,
 * plazos de obra ni opiniones normativas. Se comprueba de forma determinista DESPUÉS de
 * que el LLM redacte; si hay avisos, se regenera una vez y, si persisten, el borrador
 * queda marcado para que el arquitecto lo vea antes de aprobar.
 */
import { hasInternalNote } from '@/lib/text';

export interface ComplianceFlag {
  code: 'precio' | 'viabilidad' | 'plazo_obra' | 'normativa' | 'nota_interna';
  match: string;
}

const RULES: { code: ComplianceFlag['code']; re: RegExp }[] = [
  { code: 'precio', re: /(\d[\d.,]*\s?(€|euros?|eur\b|k€|mil euros))|(€\s?\d)|(precio (estimado|aproximado|orientativo) de)|(costar[aá]|coste (estimado|aproximado))/i },
  { code: 'viabilidad', re: /\b(es|ser[aá]|resulta|parece) (perfectamente |totalmente )?(viable|inviable|posible hacer|imposible)\b|\bviabilidad (es|ser[aá])\b/i },
  { code: 'plazo_obra', re: /(la obra|los trabajos|la reforma) (durar[aá]|llevar[aá]|tardar[aá]|estar[aá] (lista|terminada))|\b\d+\s?(semanas|meses) de obra\b|plazo de (ejecuci[oó]n|obra) (de|ser[aá])/i },
  { code: 'normativa', re: /(cumple|no cumple|incumple|permite|no permite) (la )?(normativa|ordenanza|cte|c[oó]digo t[eé]cnico|pgou)|\b(necesitar[aá]|requerir[aá]|no necesita) (licencia|permiso)/i },
];

export function checkClientEmail(text: string, internalNotes?: string | null): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) flags.push({ code: r.code, match: m[0] });
  }
  // Anotaciones de trabajo del agente ("según correo", "no consta en la foto"…)
  const note = hasInternalNote(text);
  if (note) flags.push({ code: 'nota_interna', match: note });
  // Las notas internas no pueden aparecer copiadas: se busca cualquier frase de 8+ palabras literal
  if (internalNotes) {
    const sentences = internalNotes
      .split(/[.\n!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 8);
    const lower = text.toLowerCase();
    for (const s of sentences) {
      if (lower.includes(s.toLowerCase())) flags.push({ code: 'nota_interna', match: s.slice(0, 80) });
    }
  }
  return flags;
}
