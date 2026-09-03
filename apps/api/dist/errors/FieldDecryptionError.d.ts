/**
 * Thrown when field-level decryption fails (wrong key, corrupt data).
 * Never includes ciphertext, key material, or plaintext in the message.
 */
export declare class FieldDecryptionError extends Error {
    readonly model: string;
    readonly field: string;
    readonly recordId: string | undefined;
    constructor(model: string, field: string, recordId?: string);
}
export interface DecryptFieldContext {
    model: string;
    field: string;
    recordId?: string;
}
//# sourceMappingURL=FieldDecryptionError.d.ts.map