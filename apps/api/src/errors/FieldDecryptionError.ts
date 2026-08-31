/**
 * Thrown when field-level decryption fails (wrong key, corrupt data).
 * Never includes ciphertext, key material, or plaintext in the message.
 */
export class FieldDecryptionError extends Error {
  public readonly model: string;
  public readonly field: string;
  public readonly recordId: string | undefined;

  constructor(model: string, field: string, recordId?: string) {
    const parts = [`Decryption failed: ${model}.${field}`];
    if (recordId) parts.push(`id=${recordId}`);
    parts.push('(wrong key or corrupt data)');
    super(parts.join(' '));
    this.name = 'FieldDecryptionError';
    this.model = model;
    this.field = field;
    this.recordId = recordId;
  }
}

export interface DecryptFieldContext {
  model: string;
  field: string;
  recordId?: string;
}
