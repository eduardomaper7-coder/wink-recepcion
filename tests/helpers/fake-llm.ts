/**
 * Doble determinista del modelo para los tests de integración: responde según el contenido
 * (nombre de archivo, palabras clave), así se prueba TODO el pipeline real (base de datos,
 * storage, cola, hilos, pendientes, duplicados…) sin depender de la API ni de su variabilidad.
 */
import type { Llm, LlmResult, LlmTask } from '@/agent/llm/types';

const text = (t: LlmTask<unknown>) => t.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');

function analyzeEmail(body: string) {
  const datos: { campo: string; valor: string; origen: 'cliente' | 'personal'; cita: string }[] = [];
  const add = (campo: string, valor: string | undefined, origen: 'cliente' | 'personal' = 'cliente') => valor && datos.push({ campo, valor, origen, cita: valor });
  if (/factura/i.test(body)) return { tipo: 'no_encargo', motivo: 'Factura de proveedor', cliente: { nombre: null, email: null, telefono: null }, datos: [], notas_internas: null, resumen_peticion: null, estancias: [], confirmacion_visita: null };
  if (/opci[oó]n 2/i.test(body)) return { tipo: 'confirmacion_visita', motivo: 'Elige la opción 2', cliente: { nombre: null, email: null, telefono: null }, datos: [], notas_internas: null, resumen_peticion: null, estancias: [], confirmacion_visita: { confirma: true, hueco_elegido: 2, propuesta_alternativa: null } };
  const emailMatch = /Su email es (\S+@\S+)/i.exec(body);
  if (emailMatch) return { tipo: 'respuesta', motivo: 'Aporta el email', cliente: { nombre: null, email: emailMatch[1], telefono: null }, datos: [{ campo: 'client.email', valor: emailMatch[1], origen: 'personal', cita: emailMatch[1] }], notas_internas: null, resumen_peticion: null, estancias: [], confirmacion_visita: null };
  if (/certificado energ[eé]tico que ten[ií]a/i.test(body)) return { tipo: 'respuesta', motivo: 'Envía documentos', cliente: { nombre: null, email: null, telefono: null }, datos: [], notas_internas: null, resumen_peticion: null, estancias: [], confirmacion_visita: null };

  let nombre: string | null = null;
  let telefono: string | null = null;
  if (/Lucía/.test(body)) {
    nombre = 'Lucía Fernández';
    telefono = '+34 600 123 456';
    add('property.address', 'Calle de Ibiza 23, 3º B, Madrid');
    add('property.surface_m2', '95');
    add('property.floor', 'Tercero sin ascensor');
    add('request.needs', '3 dormitorios, 2 baños y cocina abierta al salón');
    add('request.timeline', 'Empezar en primavera y entrar antes del verano');
    add('request.budget', '80-90 mil', 'personal');
  } else if (/Jorge/.test(body)) {
    nombre = 'Jorge Martínez Ruiz';
    telefono = '600 555 777';
    add('property.address', 'Calle de Alcalá 210, 5º A, 28028 Madrid');
    add('property.building_year', '1975');
    if (/110 m/.test(body)) add('property.surface_m2', '110');
    if (/60\.000/.test(body)) add('request.budget', '60.000-70.000 €');
  } else if (/Marta G[oó]mez/.test(body)) {
    nombre = 'Marta Gómez';
    telefono = '600 987 654';
    add('property.address', 'Calle de Embajadores 45, 2º izquierda', 'personal');
    add('property.building_year', '1930', 'personal');
    add('property.surface_m2', '70', 'personal');
  }
  if (telefono) add('client.phone', telefono);
  return {
    tipo: 'encargo',
    motivo: 'Solicitud de reforma',
    cliente: { nombre, email: null, telefono },
    datos,
    notas_internas: /Laura|Carlos/.test(body) && /Remitente: .*winkgroup/.test(body) ? 'Contexto interno de la llamada' : null,
    resumen_peticion: 'Reforma integral de vivienda',
    estancias: ['cocina', 'baño', 'salón'],
    confirmacion_visita: null,
  };
}

function classifyDoc(body: string) {
  const name = /Nombre original del archivo: "([^"]+)"/.exec(body)?.[1] ?? '';
  const base = { subtipo: null, legible: true, motivo_ilegible: null, fecha_documento: null, confianza: 0.95, foto: null, plano: null, nota_simple: null, datos: [] as unknown[] };
  if (/nota_simple/i.test(name))
    return {
      ...base,
      tipo: 'nota_simple',
      descripcion_corta: 'registro ibiza 23',
      resumen: 'Nota simple del piso 3º B',
      nota_simple: { referencia_catastral: '9872023VK4797A0015XQ', finca_registral: '54321', idufir: '28099000123456', direccion: 'Calle de Ibiza 23, 3º B', superficie_construida_m2: 82.4, superficie_util_m2: 71.15, titulares: ['Lucía Fernández Romero'], cargas: ['Hipoteca a favor de Banco Ejemplo Demo'], fecha_emision: '2026-11-12' },
      datos: [{ campo: 'property.building_year', valor: '1958', pagina: 1 }],
    };
  if (/plano_escaneado/i.test(name)) return { ...base, tipo: 'plano', descripcion_corta: 'estado actual escaneado', resumen: 'Plano incompleto', plano: { es_estado_actual: true, completo: false, legible: true, escala: '1:50', observaciones: 'Falta la parte derecha' } };
  if (/plano_estado_actual_completo/i.test(name)) return { ...base, tipo: 'plano', descripcion_corta: 'estado actual completo', resumen: 'Plano completo', plano: { es_estado_actual: true, completo: true, legible: true, escala: '1:50', observaciones: '' } };
  if (/certificado|CEE/i.test(name)) return { ...base, tipo: 'certificado', subtipo: 'eficiencia_energetica', descripcion_corta: 'eficiencia energetica', resumen: 'Certificado energético' };
  const estancia = /cocina/.test(name) ? 'cocina' : /bano|WhatsApp/.test(name) ? 'baño' : /salon/.test(name) ? 'salón' : /dormitorio/.test(name) ? 'dormitorio' : 'pasillo';
  return { ...base, tipo: 'foto', descripcion_corta: `${estancia} estado actual`, resumen: `Foto de ${estancia}`, foto: { estancia, estado_visible: 'Antiguo', elementos_relevantes: [] } };
}

export class FakeLlm implements Llm {
  calls: string[] = [];
  async run<T>(task: LlmTask<T>): Promise<LlmResult<T>> {
    this.calls.push(task.task);
    const body = text(task as LlmTask<unknown>);
    let data: unknown;
    switch (task.task) {
      case 'analizar_correo':
        data = analyzeEmail(body);
        break;
      case 'clasificar_documento':
        data = classifyDoc(body);
        break;
      case 'briefing':
        data = { titulo: 'Reforma integral (test)', peticion: 'Reforma', inmueble: [], estado_actual: [], condicionantes: [], presupuesto_y_plazos: { presupuesto: null, plazos: null, fuente: null }, incoherencias: [], dudas: ['¿Ascensor?'] };
        break;
      case 'alcance':
        data = { incluye: [{ partida: 'Demoliciones', detalle: 'Tabiquería' }], no_incluye: [{ partida: 'Fachada', motivo: 'Elemento común' }], a_confirmar: [], supuestos: [] };
        break;
      case 'checklist':
        data = { extra: [{ section: 'Humedades', text: 'Revisar mancha del techo del baño', reason: 'Foto del baño' }] };
        break;
      case 'correo_cliente':
        data = { asunto: 'Documentación y visita – reforma de su vivienda', cuerpo: 'Buenos días:\n\nGracias por contactar con Wink. Necesitamos:\n- documentos\n\nOpciones de visita:\n1. …' };
        break;
      default:
        throw new Error(`FakeLlm: tarea no prevista ${task.task}`);
    }
    return { data: task.schema.parse(data), model: 'fake', usage: { input: 0, output: 0 } };
  }
}
