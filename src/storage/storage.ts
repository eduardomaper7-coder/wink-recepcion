import { supabaseAdmin } from '@/lib/supabase/admin';
import { PROJECT_FOLDERS } from './files';
import { folderSync } from './sync';

export const BUCKET = 'expedientes';

export async function putFile(path: string, content: Buffer, contentType: string) {
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, content, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload (${path}): ${error.message}`);
}

export async function getFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download (${path}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function copyFile(from: string, to: string) {
  const { error } = await supabaseAdmin().storage.from(BUCKET).copy(from, to);
  if (error && !/exists/i.test(error.message)) throw new Error(`Storage copy: ${error.message}`);
}

export async function signedUrl(path: string, seconds = 300): Promise<string | null> {
  const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/** Crea la estructura de carpetas del expediente (Storage no tiene carpetas vacías: se usa .keep). */
export async function createProjectFolders(code: string) {
  await Promise.all(
    PROJECT_FOLDERS.map((f) => putFile(`${code}/${f}/.keep`, Buffer.from(''), 'text/plain')),
  );
  await folderSync().ensureFolders(code, [...PROJECT_FOLDERS]);
}

export async function removePrefix(prefix: string) {
  const sb = supabaseAdmin().storage.from(BUCKET);
  const walk = async (p: string): Promise<string[]> => {
    const { data } = await sb.list(p, { limit: 1000 });
    const files: string[] = [];
    for (const item of data ?? []) {
      const full = p ? `${p}/${item.name}` : item.name;
      if (item.id) files.push(full);
      else files.push(...(await walk(full)));
    }
    return files;
  };
  const files = await walk(prefix);
  for (let i = 0; i < files.length; i += 100) await sb.remove(files.slice(i, i + 100));
}
