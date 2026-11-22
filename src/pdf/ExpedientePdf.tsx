/* eslint-disable jsx-a11y/alt-text */
import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import path from 'node:path';

// Fuente con soporte Unicode completo (m², ⚠, ✓…). DejaVu Sans: licencia libre (Bitstream Vera).
const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');
Font.register({
  family: 'Wink',
  fonts: [
    { src: path.join(FONT_DIR, 'DejaVuSans.ttf') },
    { src: path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'), fontWeight: 'bold' },
    { src: path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf'), fontStyle: 'italic' },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export const BRAND = { ink: '#111111', cream: '#F6F3EE', stone: '#8A8178', line: '#DDD6CC', warn: '#9A3412' };

const s = StyleSheet.create({
  page: { paddingTop: 70, paddingBottom: 50, paddingHorizontal: 44, fontSize: 9.5, fontFamily: 'Wink', color: BRAND.ink, lineHeight: 1.4 },
  header: { position: 'absolute', top: 22, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 0.6, borderBottomColor: BRAND.line, paddingBottom: 8 },
  logo: { width: 62, height: 20 },
  headerText: { fontSize: 8, color: BRAND.stone },
  footer: { position: 'absolute', bottom: 22, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: BRAND.stone },
  cover: { backgroundColor: BRAND.cream, padding: 24, marginBottom: 18 },
  coverLogo: { width: 120, height: 38, marginBottom: 18 },
  kicker: { fontSize: 8, letterSpacing: 1.5, color: BRAND.stone, textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: 'bold', marginTop: 4, marginBottom: 4 },
  subtitle: { fontSize: 11, color: BRAND.stone },
  status: { marginTop: 10, alignSelf: 'flex-start', borderWidth: 0.8, borderColor: BRAND.ink, paddingVertical: 3, paddingHorizontal: 8, fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 },
  h2: { fontSize: 12.5, fontWeight: 'bold', marginTop: 16, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 0.6, borderBottomColor: BRAND.line },
  h3: { fontSize: 10.5, fontWeight: 'bold', marginTop: 8, marginBottom: 3 },
  row: { flexDirection: 'row', marginBottom: 2 },
  label: { width: 105, color: BRAND.stone },
  value: { flex: 1 },
  bullet: { flexDirection: 'row', marginBottom: 2, paddingLeft: 4 },
  dot: { width: 10 },
  p: { marginBottom: 4 },
  draft: { backgroundColor: '#FFF7ED', borderLeftWidth: 2, borderLeftColor: BRAND.warn, padding: 6, marginBottom: 6, color: BRAND.warn, fontSize: 9 },
  table: { borderTopWidth: 0.6, borderTopColor: BRAND.line },
  tr: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: BRAND.line, paddingVertical: 3 },
  th: { fontWeight: 'bold', fontSize: 8.5, color: BRAND.stone },
  muted: { color: BRAND.stone },
  twoCol: { flexDirection: 'row', gap: 16 },
  col: { flex: 1 },
});

export interface PdfData {
  logoPath: string;
  code: string;
  title: string | null;
  statusLabel: string;
  generatedAt: string;
  client: { name: string | null; email: string | null; phone: string | null };
  property: { address: string | null; surface: string | null; floor: string | null; year: string | null; cadastral: string | null };
  origin: string;
  responsible: string | null;
  documents: { name: string; type: string; status: string; description: string | null }[];
  briefingMd: string | null;
  inconsistencies: string[];
  pending: { description: string; status: string }[];
  scopeMd: string | null;
  checklist: { section: string; items: { text: string; reason: string | null }[] }[];
  visit: { confirmed: string | null; proposed: string[] };
  approvedBy: string | null;
}

/** Renderizado mínimo de Markdown (## títulos, - viñetas, **negrita**, _cursiva_). */
function Md({ md }: { md: string }) {
  const clean = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/_\((.+?)\)_/g, '($1)').replace(/_(.+?)_/g, '$1').replace(/^- \[ \] /, '');
  return (
    <View>
      {md.split('\n').map((line, i) => {
        if (/^##\s/.test(line)) return <Text key={i} style={s.h3}>{clean(line.replace(/^##\s*/, ''))}</Text>;
        if (/^>\s/.test(line)) return <Text key={i} style={s.draft}>{clean(line.replace(/^>\s*/, ''))}</Text>;
        if (/^-\s/.test(line))
          return (
            <View key={i} style={s.bullet} wrap={false}>
              <Text style={s.dot}>•</Text>
              <Text style={s.value}>{clean(line.replace(/^-\s*/, ''))}</Text>
            </View>
          );
        if (!line.trim()) return null;
        return <Text key={i} style={s.p}>{clean(line)}</Text>;
      })}
    </View>
  );
}

const Field = ({ label, value }: { label: string; value: string | null }) => (
  <View style={s.row}>
    <Text style={s.label}>{label}</Text>
    <Text style={s.value}>{value || '—'}</Text>
  </View>
);

export function ExpedientePdf({ d }: { d: PdfData }) {
  return (
    <Document title={`${d.code} · Expediente técnico inicial`} author="Wink Group" creator="Agente de recepción del encargo">
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Image src={d.logoPath} style={s.logo} />
          <Text style={s.headerText}>{d.code} · Expediente técnico inicial</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>Wink Group · Arquitectura, interiorismo y construcción · Madrid</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        <View style={s.cover}>
          <Image src={d.logoPath} style={s.coverLogo} />
          <Text style={s.kicker}>Expediente técnico inicial preparado para la visita del inmueble</Text>
          <Text style={s.title}>{d.code}</Text>
          {d.title ? <Text style={s.subtitle}>{d.title}</Text> : null}
          <Text style={s.status}>{d.statusLabel}</Text>
          <Text style={[s.muted, { marginTop: 8, fontSize: 8 }]}>
            Generado el {d.generatedAt}
            {d.approvedBy ? ` · Aprobado por ${d.approvedBy}` : ' · Pendiente de aprobación'}
          </Text>
        </View>

        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.h2}>Cliente</Text>
            <Field label="Nombre" value={d.client.name} />
            <Field label="Email" value={d.client.email} />
            <Field label="Teléfono" value={d.client.phone} />
            <Field label="Origen del encargo" value={d.origin} />
            <Field label="Responsable" value={d.responsible ?? 'Sin asignar'} />
          </View>
          <View style={s.col}>
            <Text style={s.h2}>Inmueble</Text>
            <Field label="Dirección" value={d.property.address} />
            <Field label="Superficie" value={d.property.surface} />
            <Field label="Planta" value={d.property.floor} />
            <Field label="Año de construcción" value={d.property.year} />
            <Field label="Ref. catastral" value={d.property.cadastral} />
          </View>
        </View>

        <Text style={s.h2}>Inventario documental</Text>
        <View style={s.table}>
          <View style={s.tr}>
            <Text style={[s.th, { width: '46%' }]}>Archivo</Text>
            <Text style={[s.th, { width: '16%' }]}>Tipo</Text>
            <Text style={[s.th, { width: '12%' }]}>Estado</Text>
            <Text style={[s.th, { width: '26%' }]}>Contenido</Text>
          </View>
          {d.documents.map((doc, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={{ width: '46%', fontSize: 8 }}>{doc.name}</Text>
              <Text style={{ width: '16%', fontSize: 8.5 }}>{doc.type}</Text>
              <Text style={{ width: '12%', fontSize: 8.5 }}>{doc.status}</Text>
              <Text style={{ width: '26%', fontSize: 8, color: BRAND.stone }}>{(doc.description ?? '').slice(0, 110)}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2} break>
          Briefing técnico
        </Text>
        {d.briefingMd ? <Md md={d.briefingMd} /> : <Text style={s.muted}>Sin briefing.</Text>}
        {d.inconsistencies.length ? (
          <>
            <Text style={s.h3}>Incoherencias registradas</Text>
            {d.inconsistencies.map((t, i) => (
              <View key={i} style={s.bullet}>
                <Text style={s.dot}>•</Text>
                <Text style={s.value}>{t}</Text>
              </View>
            ))}
          </>
        ) : null}

        <Text style={s.h2}>Listado de pendientes</Text>
        {d.pending.length ? (
          d.pending.map((p, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.dot}>{p.status === 'recibido' ? '✓' : '○'}</Text>
              <Text style={s.value}>
                {p.description} <Text style={s.muted}>({p.status})</Text>
              </Text>
            </View>
          ))
        ) : (
          <Text style={s.muted}>No hay pendientes.</Text>
        )}

        <Text style={s.h2} break>
          Alcance técnico preliminar
        </Text>
        {d.scopeMd ? <Md md={d.scopeMd} /> : <Text style={s.muted}>Sin alcance.</Text>}

        <Text style={s.h2} break>
          Checklist de visita
        </Text>
        {d.checklist.map((sec, i) => (
          <View key={i} wrap={false}>
            <Text style={s.h3}>{sec.section}</Text>
            {sec.items.map((it, j) => (
              <View key={j} style={s.bullet}>
                <Text style={s.dot}>☐</Text>
                <Text style={s.value}>
                  {it.text}
                  {it.reason ? <Text style={s.muted}> ({it.reason})</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={s.h2}>Planificación de la visita</Text>
        {d.visit.confirmed ? (
          <Field label="Visita confirmada" value={d.visit.confirmed} />
        ) : (
          d.visit.proposed.map((p, i) => <Field key={i} label={`Opción ${i + 1}`} value={p} />)
        )}
      </Page>
    </Document>
  );
}
