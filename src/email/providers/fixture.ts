import { randomUUID } from 'node:crypto';
import type { EmailProvider, NormalizedEmail, OutboundEmail, SendResult } from '../types';

/**
 * Proveedor sin red para ensayos y tests: no lee ningún buzón (los casos se inyectan con
 * `npm run demo:load` o desde /demo) y los envíos solo quedan registrados en la base de datos.
 */
export class FixtureProvider implements EmailProvider {
  readonly name = 'fixture';
  readonly sent: OutboundEmail[] = [];

  constructor(private domainForIds = 'aibetech.es') {}

  async fetchNew(): Promise<NormalizedEmail[]> {
    return [];
  }

  async send(msg: OutboundEmail): Promise<SendResult> {
    this.sent.push(msg);
    const messageId = `<${randomUUID()}@${this.domainForIds}>`;
    return {
      providerMessageId: messageId,
      messageId,
      deliveredTo: [...msg.to, ...(msg.cc ?? [])].map((a) => a.email),
      redirected: false,
    };
  }
}
