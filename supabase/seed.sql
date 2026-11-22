-- =====================================================================
-- Datos iniciales (idempotente). Personal y dominios son de DEMO.
-- =====================================================================
insert into settings (id, agent_mailbox, internal_domains)
values (true, 'prueba@aibetech.es', array['winkgroup.es', 'aibetech.es'])
on conflict (id) do nothing;

insert into staff (full_name, email, role) values
  ('Laura Martín (arquitecta)', 'laura.martin@winkgroup.es', 'arquitecto'),
  ('Carlos Ruiz (administración)', 'carlos.ruiz@winkgroup.es', 'admin'),
  ('Demo Aibe', 'demo@aibetech.es', 'admin')
on conflict (email) do nothing;

insert into project_types (slug, name) values ('reforma_integral_vivienda', 'Reforma integral de vivienda')
on conflict (slug) do nothing;

-- ---------- Documentación e información necesaria ----------
with pt as (select id from project_types where slug = 'reforma_integral_vivienda')
insert into required_docs_templates (project_type_id, label, kind, match_rule, required, audience, sort)
select pt.id, v.label, v.kind, v.rule::jsonb, v.req, v.aud, v.sort from pt, (values
  ('Nota simple registral actualizada (menos de 3 meses)', 'documento', '{"doc_type":"nota_simple"}', true, 'cliente', 10),
  ('Planos del estado actual completos y legibles', 'documento', '{"doc_type":"plano","flag":"es_estado_actual_completo"}', true, 'cliente', 20),
  ('Fotografías de todas las estancias (mínimo 4)', 'documento', '{"doc_type":"foto","min":4}', true, 'cliente', 30),
  ('Certificado de eficiencia energética', 'documento', '{"doc_type":"certificado","subtype":"eficiencia_energetica"}', true, 'cliente', 40),
  ('Estatutos o normas de la comunidad (horarios de obra, fachada)', 'documento', '{"doc_type":"otro","subtype":"normas_comunidad"}', false, 'cliente', 50),
  ('Informe de inspección del edificio (ITE/IEE), si existe', 'documento', '{"doc_type":"certificado","subtype":"ite_iee"}', false, 'cliente', 60),
  ('Dirección completa del inmueble', 'dato', '{"fact":"property.address"}', true, 'cliente', 70),
  ('Referencia catastral', 'dato', '{"fact":"property.cadastral_ref"}', true, 'cliente', 80),
  ('Superficie del inmueble', 'dato', '{"fact":"property.surface_m2"}', true, 'cliente', 90),
  ('Planta y existencia de ascensor', 'dato', '{"fact":"property.floor"}', true, 'cliente', 100),
  ('Teléfono de contacto del cliente', 'dato', '{"fact":"client.phone"}', true, 'cliente', 110),
  ('Presupuesto orientativo', 'dato', '{"fact":"request.budget"}', true, 'cliente', 120),
  ('Plazos deseados', 'dato', '{"fact":"request.timeline"}', true, 'cliente', 130)
) as v(label, kind, rule, req, aud, sort)
where not exists (select 1 from required_docs_templates);

-- ---------- Checklist de visita ----------
insert into checklist_templates (name, conditions, section, items, sort)
select * from (values
  ('Accesos y comunidad', '{}'::jsonb, 'Accesos y comunidad', array[
    'Comprobar acceso al portal y dimensiones del ascensor para material y escombro',
    'Preguntar horarios de obra permitidos y normas de la comunidad',
    'Valorar espacio para contenedor o saco de escombros en la vía pública',
    'Identificar al presidente/administrador de la comunidad'], 10),
  ('Medición', '{}'::jsonb, 'Toma de datos y medición', array[
    'Medir todas las estancias, alturas libres y huecos de fachada',
    'Contrastar la superficie medida con la documentación aportada',
    'Fotografiar cada estancia desde dos esquinas opuestas',
    'Anotar orientación y entrada de luz natural por estancia'], 20),
  ('Estructura general', '{}'::jsonb, 'Estructura', array[
    'Identificar muros de carga y pilares antes de plantear la redistribución',
    'Revisar fisuras en tabiques, techos y encuentros con fachada',
    'Comprobar nivelación de suelos y posibles flechas en techos'], 30),
  ('Instalaciones', '{}'::jsonb, 'Instalaciones', array[
    'Revisar cuadro eléctrico, potencia contratada y existencia de toma de tierra',
    'Identificar material de las tuberías de fontanería y llave de corte general',
    'Comprobar sistema de agua caliente y calefacción (caldera, gas, ventilación)',
    'Localizar bajantes y verificar pendientes de desagüe'], 40),
  ('Humedades', '{}'::jsonb, 'Humedades y envolvente', array[
    'Buscar manchas de humedad por capilaridad, condensación o filtración',
    'Revisar estado de la carpintería exterior y sellados',
    'Comprobar si la comunidad impone criterios de fachada o carpintería'], 50),
  ('Edificio anterior a 1960', '{"building_year_max":1959}'::jsonb, 'Edificio antiguo (anterior a 1960)', array[
    'Revisar el tipo de forjado (viguetas de madera o metálicas) y estado de los apoyos',
    'Buscar flechas, crujidos o humedades en zonas húmedas que afecten al forjado',
    'Revisar bajantes: material (fibrocemento, plomo, fundición) y estado',
    'Identificar posibles materiales con amianto (bajantes, depósitos, losetas, conductos) y recomendar análisis por empresa acreditada',
    'Comprobar si la instalación eléctrica es original y carece de toma de tierra',
    'Revisar posibles tuberías de plomo'], 60),
  ('Edificio 1960-1980', '{"building_year_min":1960,"building_year_max":1980}'::jsonb, 'Edificio 1960-1980', array[
    'Identificar posibles materiales con amianto en bajantes y conductos',
    'Revisar aislamiento térmico de fachada y carpinterías'], 61),
  ('Cocina', '{"rooms_any":["cocina"]}'::jsonb, 'Cocina', array[
    'Comprobar salida de humos y ventilación de la cocina',
    'Si se plantea cocina abierta: confirmar que el tabique a eliminar no es de carga',
    'Revisar instalación de gas y ubicación de contadores'], 70),
  ('Baños', '{"rooms_any":["baño","bano","baños"]}'::jsonb, 'Baños', array[
    'Revisar ventilación de los baños (natural o forzada)',
    'Comprobar posición de bajantes para la nueva distribución de baños',
    'Revisar impermeabilización y posibles filtraciones al vecino inferior'], 80)
) as v(name, conditions, section, items, sort)
where not exists (select 1 from checklist_templates);
