/**
 * Thrown when field-level decryption fails (wrong key, corrupt data).
 * Never includes ciphertext, key material, or plaintext in the message.
 */
export class FieldDecryptionError extends Error {
    constructor(model, field, recordId) {
        const parts = [`Decryption failed: ${model}.${field}`];
        if (recordId)
            parts.push(`id=${recordId}`);
        parts.push('(wrong key or corrupt data)');
        super(parts.join(' '));
        this.name = 'FieldDecryptionError';
        this.model = model;
        this.field = field;
        this.recordId = recordId;
    }
}
//# sourceMappingURL=FieldDecryptionError.js.map