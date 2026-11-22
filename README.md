# Agente de Recepción del Encargo · Wink Group

Desarrollado por **Aibe Technologies** para **Wink Group** (arquitectura, interiorismo y construcción, Madrid).

Cuando llega un encargo por correo (texto y adjuntos), el agente prepara el **«Expediente técnico inicial preparado para la visita del inmueble»** en estado **«Pendiente de revisión»**. Un arquitecto lo revisa, lo edita y lo aprueba. Ningún correo sale hacia el cliente sin su aprobación.

```
Correo (IMAP) ─► ingesta idempotente ─► cola (Postgres) ─► agente
                                                           │
   T0 remitente y tipo de correo ──────────────────────────┤  modelo rápido
   T1 expediente WNK-AAAA-NNNN + carpetas 01–05            │
   T2 inventario documental (clasifica leyendo el contenido)│  modelo rápido, 4 en paralelo
   T3 briefing ‖ T5 alcance ‖ T6 checklist + agenda         │  modelo potente, en paralelo
   T4 pendientes (deterministas) + borrador del correo      │
                                                           ▼
                Interfaz web (Realtime) ─► arquitecto aprueba ─► SMTP (mismo hilo)
```

---

## 1. Decisiones tomadas (resumen del plan aprobado)

| Tema | Decisión | Por qué |
|---|---|---|
| Correo (demo) | Buzón **`prueba@aibetech.es`** en Hostinger: **IMAP** para recibir y **SMTP** para enviar | Es el buzón que indicaste. Hostinger no envía avisos por webhook, así que el buzón se **consulta cada minuto** (pg_cron) y **cada 5 s** mientras la pantalla de demo está abierta |
| Correo (producción) | Misma interfaz `EmailProvider` → adaptador Gmail API o Microsoft Graph | El agente no cambia: solo se añade un adaptador (`src/email/providers/`) |
| Cola | Tabla `jobs` en Postgres con `FOR UPDATE SKIP LOCKED`, reintentos exponenciales (15 s, 1 min, 4 min) y estado «muerto» tras 4 intentos | Sin servicios externos. Se ha comprobado directamente en la base de datos |
| Idempotencia | Por id del proveedor (UIDVALIDITY:UID) **y** por cabecera `Message-ID`. Cada paso del agente guarda un punto de control: un reintento continúa desde el último paso terminado | Un mismo correo nunca genera dos expedientes |
| Modelos | `MODEL_FAST=claude-haiku-5-5` (clasificar y extraer) · `MODEL_SMART=claude-sonnet-5-5` (briefing, alcance, correo) | Configurable. Para máxima calidad: `MODEL_SMART=claude-opus-5-5` (más lento) |
| Correos internos | La petición de datos al personal y los avisos al responsable **se envían solos** (desactivable en Ajustes) | No van al cliente |
| Correos al cliente | **Siempre** pasan por un borrador con aprobación. Salen desde `prueba@aibetech.es` con el responsable en copia | Regla de Wink |
| Visibilidad | Los arquitectos ven todos los expedientes; el filtro «Asignados a mí» limita la lista | Lo más práctico para un estudio |
| Agenda | `CALENDAR_PROVIDER=mock` en la demo (agenda simulada y determinista). Los adaptadores de Google y Microsoft ya están escritos | Faltan las credenciales de Wink |
| Carpetas | Supabase Storage (`expedientes/WNK-…/01_Cliente…05_Otros`). Sincronización con Drive o SharePoint: interfaz preparada, sin implementar | Opcional según el encargo |
| Región | Supabase **eu-west-3 (París)**; funciones de Vercel en **cdg1 (París)** | Los datos se quedan en la UE |

### Verificado en documentación oficial / sin verificar
- ✔ Hostinger: IMAP `imap.hostinger.com:993` (SSL), SMTP `smtp.hostinger.com:465` (SSL) o 587 (STARTTLS).
- ✔ La API de Claude lee PDF (bloque `document`) e imágenes directamente; todos los modelos activos admiten PDF.
- ✔ Next.js 16: `after()` para trabajo tras la respuesta, `proxy.ts` sustituye a `middleware.ts`.
- ✔ Vercel: cuerpo máximo de 4,5 MB por petición; duración por defecto de 300 s con Fluid compute.
- ✘ **Sin probar con credenciales reales:** conexión al buzón de Hostinger (falta la contraseña), adaptadores de Google Calendar y Microsoft Graph, y residencia en la UE de los datos que procesa la API de Anthropic (revisar el DPA antes de producción).

---

## 2. Puesta en marcha

### 2.1 Supabase (ya creado)
- Proyecto **`wink-recepcion-encargo`** · ref `xfpqxffigjpdafxdatup` · región eu-west-3.
- Migraciones `supabase/migrations/0001…0004` **ya aplicadas**, con datos iniciales (`supabase/seed.sql`): plantillas de documentos, checklist, ajustes y personal de demo.
- Bucket privado `expedientes`, RLS en todas las tablas y Realtime activado.
- Copia las claves desde Dashboard → *Project Settings → API Keys* a `.env.local`: la pública (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) y la secreta (`SUPABASE_SERVICE_ROLE_KEY`).

> Para montarlo en otro proyecto: ejecuta en orden los SQL de `supabase/migrations/` y después `supabase/seed.sql`.

### 2.2 Variables de entorno
```bash
cp .env.example .env.local
# Rellena: claves de Supabase, ANTHROPIC_API_KEY, MAIL_PASSWORD (buzón de Hostinger) y CRON_SECRET
# (cadena larga aleatoria: openssl rand -hex 32)
```
Recomendado para la demo: `DEMO_ALLOWED_RECIPIENTS=@aibetech.es` y `DEMO_REDIRECT_TO=<tu email de aibetech.es, distinto de prueba@>`. Así, los correos a los clientes ficticios llegan a tu bandeja con el destinatario original indicado en el asunto.

### 2.3 Instalar, crear usuarios y comprobar el buzón
```bash
npm install
npm run setup:users -- admin@aibetech.es 'ContraseñaLarga-1' arquitecta@aibetech.es 'ContraseñaLarga-2'
npm run mail:check        # verifica IMAP y SMTP de prueba@aibetech.es
npm run dev               # http://localhost:3000
npm run worker -- --loop  # en otra terminal, en local: lee el buzón y procesa la cola cada 5 s
```

### 2.4 Despliegue en Vercel
1. Importa el repositorio en Vercel (Next.js se detecta solo; `vercel.json` fija la región `cdg1`).
2. Copia **todas** las variables de `.env.local` en *Settings → Environment Variables*. En producción, `APP_BASE_URL` es la URL de Vercel.
3. Ejecuta **una vez** `supabase/cron.sql` en el SQL Editor de Supabase, con tu URL de Vercel y el mismo `CRON_SECRET`. Programa la lectura del buzón cada minuto y la red de seguridad de la cola cada 5 minutos.
4. Los recordatorios diarios los lanza Vercel Cron (`vercel.json`, lunes a viernes a las 8:00 UTC). Vercel envía `Authorization: Bearer $CRON_SECRET`.

---

## 3. Uso

| Pantalla | Qué hace |
|---|---|
| `/expedientes` | Tablero en tiempo real: Pendiente de revisión · Esperando al cliente · Listo para visita. Filtro «Asignados a mí» |
| `/expedientes/[id]` | Cliente, inmueble y datos con su fuente · origen y responsable · inventario con vista previa y reclasificación · briefing · pendientes · alcance (BORRADOR) · checklist · hilo de correos · auditoría. Botones **Aprobar expediente**, **Aprobar y enviar correo al cliente**, **Agendar visita** y **Exportar PDF** |
| `/bandeja` | Correos que no son encargos, respuestas automáticas, respuestas sin hilo reconocible y errores. Permite reprocesarlos o marcarlos como revisados |
| `/ajustes` | (admin) Dominios internos, personal, usuarios, plantillas de documentación necesaria y de checklist, recordatorios, horario de visitas, firma |
| `/demo` | Pantalla para proyectar: las 6 tareas se iluminan en directo, con cronómetro |

---

## 4. Guion de la demo (≈ 10 minutos)

**Antes de empezar (5 min antes):**
```bash
npm run demo:reset -- --yes     # deja 0 expedientes y la numeración en WNK-2026-0001
```
Abre `/demo` en el proyector (pantalla completa) y `/expedientes` en otra pestaña. Inicia sesión antes.

1. **El problema (1 min).** Hoy un encargo llega desordenado: un reenvío de WhatsApp, fotos, un plano a medias y una nota simple. Alguien tarda horas en ordenarlo.
2. **Lanzar el caso 1 (1 min).** En `/demo`, pulsa *«Caso 1 · Reenvío de Laura…»*. **Versión en directo:** activa «Escuchar el buzón» y reenvía tú mismo un correo con fotos a `prueba@aibetech.es` desde una cuenta de `@aibetech.es` (dominio interno: el agente te trata como personal de Wink). Las imágenes y PDF de ejemplo están en `demo/fixtures/assets/`.
3. **Las 6 tareas en directo (≈ 40–60 s).** Comenta cada tarjeta según se ilumina:
   - T0: reconoce que es un **reenvío** de Laura y que la **clienta es Lucía**, no Laura.
   - T1: crea **WNK-2026-0001** y sus 5 carpetas.
   - T2: 8 archivos clasificados **leyendo el contenido**; detecta **1 duplicado** (la foto de WhatsApp reenviada dos veces).
   - T3–T6: briefing, alcance, checklist y huecos de visita a la vez.
4. **Abrir el expediente (3 min).**
   - *Resumen:* la **incoherencia de superficie** (95 m² según Lucía frente a 82,40 m² en la nota simple) y la tabla «Datos extraídos y su fuente».
   - *Documentos:* nombres `WNK-2026-0001_tipo_descripcion_fecha`, vista previa, el plano marcado como **incompleto** y la reclasificación con un clic.
   - *Briefing:* cada dato con su fuente; la **hipoteca** vigente de la nota simple.
   - *Checklist:* edificio de **1958** → forjados, bajantes y amianto, más lo específico (humedad del baño, cuadro de plomos).
   - *Correos:* el borrador pide el **certificado energético** y el **plano completo**, propone 3 huecos de visita y **no menciona los 80–90 k€** de las notas internas de Laura (el control de cumplimiento lo vigila).
5. **Aprobar y enviar (1 min).** Pulsa *«Aprobar y enviar correo al cliente»*. Enseña el correo en la bandeja de redirección, con el asunto `[DEMO → lucia…]`.
6. **El cliente responde (1 min).** En `/demo`: *«Respuesta del cliente del caso 1 con documentos nuevos»*. Los pendientes pasan a «Recibido» y se avisa a Laura.
7. **Confirma la visita (30 s).** *«El cliente del caso 1 confirma la visita»*. El expediente pasa a «Visita agendada» y se registra en la agenda.
8. **Casos de respaldo** si sobra tiempo: *Caso 2* (cliente directo) y luego *Caso 2b* (el mismo encargo reenviado por Carlos: **se une** al expediente en vez de duplicarse); *Caso 3* (Laura escribe sin el email del cliente: el agente **se lo pide a Laura** antes de nada); *Caso 4* (una factura → **bandeja de revisión**).
9. **Exportar PDF** con la imagen de Wink.

> Plan B sin red: `EMAIL_PROVIDER=fixture`. Los casos se lanzan igual desde `/demo` o con `npm run demo:load -- caso1` y no se envía ningún correo real.

---

## 5. Tests
```bash
npm test                 # 49 tests unitarios (lógica de decisión, sin red)
npm run typecheck
# Integración de punta a punta contra Supabase real, con el modelo simulado (¡borra los datos de demo!):
INTEGRATION_ALLOW_RESET=true EMAIL_PROVIDER=fixture DEMO_MODE=true npm run test:integration
```
Escenarios pedidos y dónde se prueban:

| Escenario | Unitario | Integración |
|---|---|---|
| Encargo completo del cliente | `pending.test.ts` (sin pendientes obligatorios) | caso 2 |
| Encargo con documentos faltantes | `pending.test.ts` | caso 1 (certificado y plano completo) |
| Correo reenviado por el personal | `intake.test.ts`, `heuristics.test.ts` | caso 1 |
| Personal sin email del cliente | `intake.test.ts` | caso 3 + respuesta de Laura |
| Encargo duplicado por las dos vías | `dedupe.test.ts` | caso 2 + 2b |
| Respuesta del cliente con documentos | — | respuesta_docs |
| Confirmación de visita | `slots.test.ts` | respuesta_visita |
| Correo que no es un encargo | `heuristics.test.ts` (respuestas automáticas) | caso 4 |

Además: incoherencias (`facts.test.ts`), control de precios, viabilidad, plazos, normativa y notas internas (`compliance.test.ts`), validación de adjuntos por tipo real (`files.test.ts`), protección de envíos en la demo (`outbound.test.ts`), interpretación de .eml (`parse.test.ts`) e idempotencia (integración).

---

## 6. Seguridad
- Credenciales solo en variables de entorno. La clave `service_role` solo se usa en el servidor; toda acción de usuario comprueba antes la sesión y el rol.
- **RLS** en todas las tablas: el equipo lee; admin y arquitecto editan; la configuración es solo de admin; la cola, el estado del buzón y los contadores solo los toca el servidor.
- Adjuntos: tipo real por **firma binaria** (un `.exe` renombrado a `.pdf` se rechaza), máximo 25 MB por archivo, 60 MB por correo y 30 archivos. Solo PDF, JPEG, PNG, WebP y HEIC. **Nunca se ejecuta nada.** Los rechazados se piden de nuevo en PDF.
- El contenido de los correos y documentos se trata como **dato, no como instrucción** (prompts). Además, el modelo **no tiene ninguna herramienta de envío**: solo crea borradores.
- Logs estructurados con **emails, teléfonos y DNI enmascarados**. Nunca se registran cuerpos de correo.
- Auditoría (`events`) de todo lo que hace el agente y de quién aprueba qué.
- Endpoints internos (`/api/cron/*`, `/api/worker`) protegidos con `CRON_SECRET`.

---

## 7. Estructura
```
app/                     Next.js (App Router): páginas, server actions y rutas API
  (app)/expedientes      tablero y vista del expediente (+ actions.ts)
  (app)/bandeja          correos para revisar
  (app)/ajustes          configuración (admin)
  demo/                  pantalla de proyección
  api/cron/poll          lee el buzón y procesa la cola
  api/demo               lanza casos de ejemplo / lee el buzón al momento
  api/projects/[id]/pdf  exportación a PDF
src/agent/               el agente: pipeline, pasos, prompts, esquemas, lógica pura
src/email/               EmailProvider (IMAP/SMTP, fixture), parser y heurísticas
src/calendar/            CalendarProvider (mock, Google, Microsoft) y propuesta de huecos
src/storage/             Storage, validación de adjuntos, sincronización opcional
src/queue/               cola y worker
supabase/                migraciones, datos iniciales y cron
demo/fixtures/           casos ficticios (.eml + assets); se regeneran con scripts/generate_fixtures.py
scripts/                 alta de usuarios, carga y reinicio de la demo, worker local, comprobación del buzón
tests/                   unitarios e integración
```

## 8. WhatsApp (app `C:\Whatsapp-Wink`, conectada)

Las dos aplicaciones siguen separadas (cada una con su Supabase) y se hablan por una API interna con un secreto compartido (`INTEGRATION_SECRET`, el mismo en las dos `.env.local`). En local: **WhatsApp en `localhost:3000`** y **Recepción en `localhost:3001`**.

| Quién escribe por WhatsApp | Qué pasa |
|---|---|
| Cliente nuevo | Lo atiende el asistente de captación de WhatsApp. **Al reservar la visita** se crea el expediente aquí con la ficha, la conversación, las fotos y los planos, y con la visita ya confirmada (no se proponen huecos) |
| Cliente con expediente | Sus mensajes, fotos y notas de voz (transcritas) van al expediente: se reclasifica, se actualizan los pendientes y se avisa al responsable |
| Personal de Wink (por su móvil, en **Ajustes → Personal**) | El asistente no le responde como a un cliente. Se le pregunta con una lista **a qué expediente** van sus fotos y notas (visitas próximas y asignados; también vale escribir el código `WNK-…`). Su texto queda en **Notas internas** del expediente |

**Cómo se responde por WhatsApp**, a elegir en **Ajustes** (por defecto, según quién escribe) y en cada expediente o conversación:

| Modo | Qué hace |
|---|---|
| Asistente automático | Responde el asistente de WhatsApp (sin precios, aviso de privacidad) |
| Borrador con aprobación | El agente prepara la respuesta aquí; al aprobarla sale por WhatsApp |
| Solo recibir | No se responde; todo va al expediente |
| Solo equipo | Contesta una persona desde la bandeja de WhatsApp |

Los borradores al cliente indican su canal y se puede cambiar entre **correo** y **WhatsApp**. Por WhatsApp solo se puede escribir si el cliente ha escrito en las últimas 24 h (regla de Meta); si no, el envío lo explica.

## 9. Pendiente para producción
- Adaptador Gmail API o Microsoft Graph, según la suite de Wink (la interfaz ya está lista).
- Probar Google Calendar o Microsoft 365 con las credenciales de Wink.
- Sincronización de carpetas con Drive o SharePoint (opcional).
- Revisar el DPA de Anthropic y la base legal del tratamiento (consentimiento del cliente: los campos ya existen en `clients`).
- Sustituir las fotos ilustrativas de la demo por fotos reales con licencia (`demo/fixtures/assets/`) y regenerar los `.eml`.
