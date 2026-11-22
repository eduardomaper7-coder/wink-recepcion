/** Modelo de correo independiente del proveedor. El agente solo conoce estos tipos. */

export interface Address {
  email: string;
  name?: string | null;
}

export interface NormalizedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  /** true si va incrustado (logo de firma, etc.) */
  inline?: boolean;
}

export interface NormalizedEmail {
  provider: string;
  providerMessageId: string;
  messageId: string | null; // cabecera Message-ID
  inReplyTo: string | null;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo?: Address | null;
  subject: string;
  text: string;
  html?: string | null;
  date: Date;
  headers: Record<string, string>;
  attachments: NormalizedAttachment[];
  /** .eml original (opcional) para guardarlo como evidencia */
  raw?: Buffer;
  /** Canal de entrada. Por defecto, correo. */
  channel?: 'email' | 'whatsapp';
  /** WhatsApp: teléfono del remitente (E.164) y conversación en la app de WhatsApp */
  fromPhone?: string | null;
  waConversationId?: string | null;
}

export interface OutboundEmail {
  from: Address;
  to: Address[];
  cc?: Address[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string[];
}

export interface SendResult {
  providerMessageId: string;
  messageId: string;
  /** destinatarios reales tras aplicar la protección de demo */
  deliveredTo: string[];
  redirected: boolean;
}

export interface EmailProvider {
  readonly name: string;
  /** Descarga los correos nuevos desde la última sincronización. */
  fetchNew(): Promise<NormalizedEmail[]>;
  /** Marca como procesado en el buzón (p. ej. \Seen), si aplica. */
  acknowledge?(providerMessageIds: string[]): Promise<void>;
  send(msg: OutboundEmail): Promise<SendResult>;
}
