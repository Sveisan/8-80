export interface SendOptions { idempotencyKey: string; }
export interface Receipt { id: string; }
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';
export interface TransportInfo {
  transactional?: boolean;
  /** File previews must never count as a provider-accepted send. */
  previewOnly?: boolean;
  /** Safe retry window for the same request and idempotency key. */
  retryWindowMs?: number;
  deliveryStatus?(id: string): Promise<DeliveryStatus>;
}
export class SendFailure extends Error {
  constructor(readonly disposition: 'retry' | 'permanent' | 'uncertain', message: string) { super(message); }
}
