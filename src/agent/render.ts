/** Representación en Markdown de los resultados (para la interfaz, el PDF y la edición). */
import type { Briefing, Scope } from './schemas';
import type { ChecklistSection } from './checklist';

export function briefingToMarkdown(b: Briefing): string {
  const lines: string[] = [];
  lines.push(`## Qué quiere el cliente`, b.peticion, '');
  if (b.inmueble.length) {
    lines.push('## Datos del inmueble');
    for (const d of b.inmueble) lines.push(`- **${d.dato}:** ${d.valor} _(${d.fuente})_`);
    lines.push('');
  }
  if (b.estado_actual.length) {
    lines.push('## Estado actual según la documentación');
    for (const e of b.estado_actual) lines.push(`- ${e.observacion} _(${e.fuente})_`);
    lines.push('');
  }
  if (b.condicionantes.length) {
    lines.push('## Condicionantes visibles');
    for (const c of b.condicionantes) lines.push(`- ${c.texto} _(${c.fuente})_`);
    lines.push('');
  }
  const pp = b.presupuesto_y_plazos;
  lines.push('## Presupuesto y plazos');
  lines.push(`- **Presupuesto orientativo:** ${pp.presupuesto ?? 'No indicado'}`);
  lines.push(`- **Plazos deseados:** ${pp.plazos ?? 'No indicados'}${pp.fuente ? ` _(${pp.fuente})_` : ''}`, '');
  if (b.incoherencias.length) {
    lines.push('## ⚠ Incoherencias detectadas');
    for (const i of b.incoherencias) lines.push(`- **${i.campo}:** ${i.descripcion} _(${i.fuentes.join(' / ')})_`);
    lines.push('');
  }
  if (b.dudas.length) {
    lines.push('## Dudas abiertas');
    for (const d of b.dudas) lines.push(`- ${d}`);
  }
  return lines.join('\n').trim();
}

export function scopeToMarkdown(s: Scope): string {
  const lines = ['> **BORRADOR** — alcance preliminar propuesto por el agente, pendiente de revisión del arquitecto.', ''];
  lines.push('## Incluye');
  for (const i of s.incluye) lines.push(`- **${i.partida}:** ${i.detalle}`);
  lines.push('', '## No incluye');
  for (const i of s.no_incluye) lines.push(`- **${i.partida}:** ${i.motivo}`);
  if (s.a_confirmar.length) {
    lines.push('', '## A confirmar en la visita o con el cliente');
    for (const i of s.a_confirmar) lines.push(`- ${i}`);
  }
  if (s.supuestos.length) {
    lines.push('', '## Supuestos');
    for (const i of s.supuestos) lines.push(`- ${i}`);
  }
  return lines.join('\n');
}

export function checklistToMarkdown(sections: ChecklistSection[]): string {
  return sections
    .map((s) => [`## ${s.section}`, ...s.items.map((i) => `- [ ] ${i.text}${i.reason ? ` _(${i.reason})_` : ''}`)].join('\n'))
    .join('\n\n');
}
