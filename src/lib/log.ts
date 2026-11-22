import { maskEmail, maskPhone } from './pii';

type Level = 'debug' | 'info' | 'warn' | 'error';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(\+?\d[\d\s.-]{7,}\d)/g;
const DNI_RE = /\b\d{8}[A-Z]\b/gi;

/** Enmascara datos personales en cualquier texto antes de registrarlo. */
export function redact(text: string): string {
  return text.replace(EMAIL_RE, (m) => maskEmail(m)).replace(PHONE_RE, (m) => maskPhone(m)).replace(DNI_RE, '********X');
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const line = {
    t: new Date().toISOString(),
    level,
    msg: redact(msg),
    ...(ctx ? { ctx: JSON.parse(redact(JSON.stringify(ctx))) } : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

/** Logger estructurado. Nunca registra cuerpos de correo ni datos personales completos. */
export const log = {
  debug: (m: string, c?: Record<string, unknown>) => process.env.LOG_DEBUG === 'true' && write('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => write('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => write('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => write('error', m, c),
};
