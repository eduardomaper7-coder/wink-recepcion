import { env } from '@/config/env';
import { log } from '@/lib/log';

/**
 * Sincronización opcional de las carpetas del expediente con Google Drive o SharePoint.
 * La fuente de verdad es Supabase Storage; la sincronización es "best effort" y nunca
 * bloquea el pipeline.
 */
export interface FolderSync {
  readonly name: string;
  ensureFolders(projectCode: string, folders: string[]): Promise<void>;
  upload(projectCode: string, folder: string, filename: string, content: Buffer, mime: string): Promise<void>;
}

class NoSync implements FolderSync {
  readonly name = 'none';
  async ensureFolders() {}
  async upload() {}
}

/**
 * Pendiente de credenciales del cliente: el adaptador concreto (Drive API v3 / Microsoft Graph
 * driveItem) se implementará cuando sepamos qué suite usa Wink. Mientras, registra un aviso.
 */
class NotConfiguredSync implements FolderSync {
  constructor(readonly name: string) {}
  async ensureFolders(code: string) {
    log.warn(`Sincronización ${this.name} no implementada todavía; se omite`, { code });
  }
  async upload() {}
}

let instance: FolderSync | null = null;
export function folderSync(): FolderSync {
  if (instance) return instance;
  const p = env().FOLDER_SYNC_PROVIDER;
  instance = p === 'none' ? new NoSync() : new NotConfiguredSync(p);
  return instance;
}
