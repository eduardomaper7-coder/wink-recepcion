/** Etiquetas de interfaz (es-ES). */
export const STATUS_LABEL: Record<string, string> = {
  procesando: 'Procesando',
  esperando_datos_internos: 'Esperando datos internos',
  pendiente_revision: 'Pendiente de revisión',
  esperando_cliente: 'Esperando al cliente',
  listo_para_visita: 'Listo para visita',
  visita_agendada: 'Visita agendada',
  archivado: 'Archivado',
};

export const ORIGIN_LABEL: Record<string, string> = {
  cliente_directo: 'Cliente directo',
  reenvio_personal: 'Reenvío del personal de Wink',
  encargo_personal: 'Encargo escrito por el personal',
  cc_personal: 'Personal en copia de una respuesta',
  whatsapp: 'WhatsApp',
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  foto: 'Foto',
  plano: 'Plano',
  nota_simple: 'Nota simple',
  certificado: 'Certificado',
  contrato: 'Contrato',
  otro: 'Otro',
};

export const DOC_STATUS_LABEL: Record<string, string> = { ok: 'OK', ilegible: 'Ilegible', duplicado: 'Duplicado', rechazado: 'Rechazado' };

export const PENDING_STATUS_LABEL: Record<string, string> = { pendiente: 'Pendiente', pedido: 'Pedido', recibido: 'Recibido', descartado: 'Descartado' };

export const DRAFT_KIND_LABEL: Record<string, string> = {
  pendientes_y_visita: 'Pendientes y propuesta de visita',
  recordatorio: 'Recordatorio',
  solicitud_interna: 'Solicitud interna',
  aviso_interno: 'Aviso interno',
  confirmacion_visita: 'Confirmación de visita',
  respuesta: 'Respuesta al cliente',
};

/** Columnas de la lista de expedientes (tablero). */
export const BOARD_COLUMNS = [
  { key: 'pendiente_revision', label: 'Pendiente de revisión', statuses: ['procesando', 'pendiente_revision', 'esperando_datos_internos'] },
  { key: 'esperando_cliente', label: 'Esperando al cliente', statuses: ['esperando_cliente'] },
  { key: 'listo_para_visita', label: 'Listo para visita', statuses: ['listo_para_visita', 'visita_agendada'] },
] as const;
