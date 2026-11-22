/** Catálogo de datos que el agente sabe extraer y rastrear con su fuente. */
export const FACT_FIELDS = [
  'client.name',
  'client.email',
  'client.phone',
  'property.address',
  'property.postal_code',
  'property.city',
  'property.surface_m2',
  'property.useful_surface_m2',
  'property.floor',
  'property.elevator',
  'property.typology',
  'property.building_year',
  'property.cadastral_ref',
  'property.registry_finca',
  'property.owners',
  'property.charges',
  'request.needs',
  'request.rooms',
  'request.budget',
  'request.timeline',
  'request.services',
  'request.restrictions',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export const FIELD_LABELS: Record<FactField, string> = {
  'client.name': 'Nombre del cliente',
  'client.email': 'Email del cliente',
  'client.phone': 'Teléfono del cliente',
  'property.address': 'Dirección',
  'property.postal_code': 'Código postal',
  'property.city': 'Municipio',
  'property.surface_m2': 'Superficie construida (m²)',
  'property.useful_surface_m2': 'Superficie útil (m²)',
  'property.floor': 'Planta',
  'property.elevator': 'Ascensor',
  'property.typology': 'Tipología',
  'property.building_year': 'Año de construcción',
  'property.cadastral_ref': 'Referencia catastral',
  'property.registry_finca': 'Finca registral',
  'property.owners': 'Titulares',
  'property.charges': 'Cargas',
  'request.needs': 'Necesidades del cliente',
  'request.rooms': 'Estancias a reformar',
  'request.budget': 'Presupuesto orientativo',
  'request.timeline': 'Plazos deseados',
  'request.services': 'Servicios contratados (confirmados)',
  'request.restrictions': 'Restricciones',
};

/** Campos numéricos que se comparan entre fuentes para detectar incoherencias. */
export const NUMERIC_FIELDS: FactField[] = ['property.surface_m2', 'property.useful_surface_m2', 'property.building_year'];
/** Campos de texto que deben coincidir entre fuentes (normalizados). */
export const IDENTITY_FIELDS: FactField[] = ['property.cadastral_ref', 'property.floor'];
