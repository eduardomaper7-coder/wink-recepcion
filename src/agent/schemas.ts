/** Esquemas de salida de cada tarea del LLM (se envían como tool input_schema y se validan). */
import { z } from 'zod';
import { FACT_FIELDS } from './fields';

const nstr = z.string().nullable();

export const DatoSchema = z.object({
  campo: z.enum(FACT_FIELDS),
  valor: z.string().describe('Solo el valor, limpio y sin comentarios ni paréntesis. Superficies: solo el número de m². Año: 4 cifras.'),
  origen: z.enum(['cliente', 'personal']).describe('cliente: lo dice el cliente; personal: lo añade la persona de Wink en sus notas'),
  cita: z.string().describe('Fragmento literal breve (máx. 12 palabras) donde aparece el dato'),
});

export const EmailAnalysisSchema = z.object({
  tipo: z.enum(['encargo', 'respuesta', 'confirmacion_visita', 'no_encargo']),
  motivo: z.string().describe('Una frase que justifica la clasificación'),
  cliente: z.object({ nombre: nstr, email: nstr, telefono: nstr }),
  datos: z.array(DatoSchema).describe('Solo datos explícitos del correo. No inventar.'),
  notas_internas: nstr.describe('Resumen del contexto que aporta el personal de Wink (llamadas, impresiones). null si no hay.'),
  resumen_peticion: nstr.describe('Qué quiere el cliente, en 1-3 frases neutras'),
  estancias: z.array(z.string()).describe('Estancias que se quieren reformar (cocina, baño, salón...)'),
  confirmacion_visita: z
    .object({
      confirma: z.boolean(),
      hueco_elegido: z.number().int().nullable().describe('Índice (1, 2, 3...) del hueco propuesto que elige el cliente, si lo dice'),
      propuesta_alternativa: nstr.describe('Fecha/hora alternativa que propone el cliente, en texto'),
    })
    .nullable(),
});
export type EmailAnalysis = z.infer<typeof EmailAnalysisSchema>;

export const DocumentAnalysisSchema = z.object({
  tipo: z.enum(['foto', 'plano', 'nota_simple', 'certificado', 'contrato', 'otro']),
  subtipo: nstr.describe(
    'Para certificado: eficiencia_energetica | ite_iee | instalacion_electrica | otro. Para otro: normas_comunidad | escritura | licencia | presupuesto | factura | otro. null si no aplica',
  ),
  descripcion_corta: z.string().describe('3-5 palabras para el nombre de archivo, p. ej. "cocina estado actual"'),
  resumen: z.string().describe('Qué es y qué contiene, 1-2 frases'),
  legible: z.boolean(),
  motivo_ilegible: nstr,
  fecha_documento: nstr.describe('YYYY-MM-DD si consta en el documento'),
  confianza: z.number().min(0).max(1),
  foto: z
    .object({
      estancia: z.string(),
      estado_visible: z.string().describe('Estado de conservación observable, sin valoraciones técnicas definitivas'),
      elementos_relevantes: z.array(z.string()).describe('p. ej. "bajante de fibrocemento", "mancha de humedad en techo", "instalación eléctrica vista"'),
    })
    .nullable(),
  plano: z
    .object({
      es_estado_actual: z.boolean().nullable(),
      completo: z.boolean().nullable().describe('false si falta parte de la vivienda, está cortado o le faltan cotas esenciales'),
      legible: z.boolean(),
      escala: nstr,
      observaciones: z.string(),
    })
    .nullable(),
  nota_simple: z
    .object({
      referencia_catastral: nstr,
      finca_registral: nstr,
      idufir: nstr,
      direccion: nstr,
      superficie_construida_m2: z.number().nullable(),
      superficie_util_m2: z.number().nullable(),
      titulares: z.array(z.string()),
      cargas: z.array(z.string()).describe('Hipotecas, servidumbres, anotaciones. Vacío si "libre de cargas"'),
      fecha_emision: nstr,
    })
    .nullable(),
  datos: z.array(
    z.object({
      campo: z.enum(FACT_FIELDS),
      valor: z.string(),
      pagina: z.number().int().nullable(),
    }),
  ),
});
export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

const Fuente = z.string().describe('Documento o correo de donde sale, p. ej. "Nota simple (pág. 1)" o "Correo del cliente"');

export const BriefingSchema = z.object({
  titulo: z.string().describe('Título breve del expediente, p. ej. "Reforma integral piso C/ Ibiza 23, 3ºB"'),
  peticion: z.string().describe('Qué quiere el cliente, 2-4 frases'),
  inmueble: z.array(z.object({ dato: z.string(), valor: z.string(), fuente: Fuente })),
  estado_actual: z.array(z.object({ observacion: z.string(), fuente: Fuente })),
  condicionantes: z.array(z.object({ texto: z.string(), fuente: Fuente })),
  presupuesto_y_plazos: z.object({ presupuesto: nstr, plazos: nstr, fuente: nstr }),
  incoherencias: z.array(z.object({ campo: z.string(), descripcion: z.string(), fuentes: z.array(z.string()) })),
  dudas: z.array(z.string()).describe('Preguntas abiertas para el arquitecto o el cliente'),
});
export type Briefing = z.infer<typeof BriefingSchema>;

export const ScopeSchema = z.object({
  incluye: z.array(z.object({ partida: z.string(), detalle: z.string() })),
  no_incluye: z.array(z.object({ partida: z.string(), motivo: z.string() })),
  a_confirmar: z.array(z.string()).describe('Aspectos del alcance que dependen de la visita o del cliente'),
  supuestos: z.array(z.string()),
});
export type Scope = z.infer<typeof ScopeSchema>;

export const ChecklistExtraSchema = z.object({
  extra: z
    .array(z.object({ section: z.string(), text: z.string(), reason: z.string().describe('Por qué se añade, citando la observación concreta') }))
    .max(10),
});

export const ClientEmailSchema = z.object({
  asunto: z.string(),
  cuerpo: z.string().describe('Texto plano. Sin firma (se añade después).'),
});
export type ClientEmail = z.infer<typeof ClientEmailSchema>;
