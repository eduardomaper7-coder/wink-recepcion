import { z } from 'zod';

/**
 * Variables de entorno del servidor, validadas de forma perezosa (solo cuando se usan),
 * para que el build y los tests unitarios no exijan credenciales.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  MODEL_FAST: z.string().default('claude-haiku-5-5'),
  MODEL_SMART: z.string().default('claude-sonnet-5-5'),
  EMAIL_PROVIDER: z.enum(['imap', 'fixture']).default('fixture'),
  AGENT_MAILBOX: z.string().email().default('prueba@aibetech.es'),
  AGENT_DISPLAY_NAME: z.string().default('Wink Group · Encargos'),
  IMAP_HOST: z.string().default('imap.hostinger.com'),
  IMAP_PORT: z.coerce.number().default(993),
  SMTP_HOST: z.string().default('smtp.hostinger.com'),
  SMTP_PORT: z.coerce.number().default(465),
  MAIL_USER: z.string().optional().default(''),
  MAIL_PASSWORD: z.string().optional().default(''),
  IMAP_SENT_FOLDER: z.string().default('auto'),
  DEMO_ALLOWED_RECIPIENTS: z.string().optional().default(''),
  DEMO_REDIRECT_TO: z.string().optional().default(''),
  CALENDAR_PROVIDER: z.enum(['mock', 'google', 'microsoft']).default('mock'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REFRESH_TOKEN: z.string().optional().default(''),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),
  MS_TENANT_ID: z.string().optional().default(''),
  MS_CLIENT_ID: z.string().optional().default(''),
  MS_CLIENT_SECRET: z.string().optional().default(''),
  MS_CALENDAR_USER: z.string().optional().default(''),
  FOLDER_SYNC_PROVIDER: z.enum(['none', 'gdrive', 'sharepoint']).default('none'),
  CRON_SECRET: z.string().optional().default(''),
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  // Integración con la app de WhatsApp de Wink (vacío = desactivada)
  WHATSAPP_APP_URL: z.string().optional().default(''),
  INTEGRATION_SECRET: z.string().optional().default(''),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración incompleta: revisa las variables de entorno (${missing}). Ver .env.example`);
  }
  cached = parsed.data;
  return cached;
}

/** Solo para tests. */
export function resetEnvCache() {
  cached = null;
}
