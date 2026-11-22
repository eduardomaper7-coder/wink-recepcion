/** Carga .env.local (o .env) para los scripts de consola. */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) {
    config({ path: f, quiet: true });
    break;
  }
}
