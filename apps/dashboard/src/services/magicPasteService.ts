import type { MagicPasteResponse, MagicPastePattern, MagicPasteSettings } from '../types/magicPaste';

/**
 * Service wrapper untuk API Magic Paste (POST /api/admin/products/magic-paste).
 * Memakai fetch native — timeout 10 detik, tanpa retry (retry di komponen).
 */

/**
 * Panggil endpoint Magic Paste.
 *
 * @param storeId ID store tujuan (UUID)
 * @param text Teks bebas yang akan diekstrak (10–2000 karakter)
 * @param token Admin bearer token
 * @param preview true = hanya ekstrak (product: null), false = ekstrak + create
 * @returns Promise<MagicPasteResponse>
 *
 * Contoh:
 * ```ts
 * // Preview (tidak create)
 * const res = await magicPasteService.extract('store-uuid', 'Kangkung 5000', token, true);
 * if (res.success && res.data) { /* preview *\/ }
 * ```
 */
export async function extract(
  storeId: string,
  text: string,
  token: string,
  preview = false
): Promise<MagicPasteResponse> {
  try {
    const url = preview ? '/api/admin/products/magic-paste?preview=true' : '/api/admin/products/magic-paste';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ storeId, text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401) {
      return { success: false, error: { code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' } };
    }

    const body = (await res.json()) as MagicPasteResponse;

    if (!res.ok || !body.success) {
      return {
        success: false,
        error: {
          code: body.error?.code ?? 'ERR_API',
          message: body.error?.message ?? `Request gagal (HTTP ${res.status})`,
          details: body.error?.details,
        },
      };
    }

    return body;
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      success: false,
      error: {
        code: isTimeout ? 'ERR_TIMEOUT' : 'ERR_NETWORK',
        message: isTimeout ? 'Request timeout (10 detik)' : 'Network error — coba lagi',
      },
    };
  }
}

/**
 * Service wrapper untuk Pattern Library & Settings (Phase 1.9.8).
 * Endpoint: /api/admin/magic-paste
 */

async function apiCall(token: string, method: string, path: string, body?: any): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api/admin/magic-paste${path}`, opts);
    const resp = (await res.json()) as any;
    if (!res.ok || !resp.success) {
      return { success: false, error: resp.error?.message || `HTTP ${res.status}` };
    }
    return { success: true, data: resp.data };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { success: false, error: isTimeout ? 'Request timeout' : 'Network error — coba lagi' };
  }
}

/** Ambil semua patterns + settings. */
async function getConfig(token: string): Promise<{ success: boolean; data?: { patterns: MagicPastePattern[]; settings: MagicPasteSettings }; error?: string }> {
  const res = await apiCall(token, 'GET', '');
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

/** Buat pattern baru. */
async function createPattern(token: string, pattern: Omit<MagicPastePattern, 'id'>): Promise<{ success: boolean; data?: MagicPastePattern; error?: string }> {
  const res = await apiCall(token, 'POST', '/patterns', pattern);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

/** Update pattern. */
async function updatePattern(token: string, id: string, pattern: Omit<MagicPastePattern, 'id'>): Promise<{ success: boolean; data?: MagicPastePattern; error?: string }> {
  const res = await apiCall(token, 'PUT', `/patterns/${id}`, pattern);
  if (!res.success) return { success: false, error: res.error };
  return { success: true, data: res.data };
}

/** Hapus pattern. */
async function deletePattern(token: string, id: string): Promise<{ success: boolean; error?: string }> {
  const res = await apiCall(token, 'DELETE', `/patterns/${id}`);
  if (!res.success) return { success: false, error: res.error };
  return { success: true };
}

async function updateSettings(token: string, settings: MagicPasteSettings): Promise<{ success: boolean; data?: MagicPasteSettings; error?: string }> {
  try {
    const res = await fetch('/api/admin/magic-paste/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(settings),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as any;
    if (!res.ok || !body.success) {
      return { success: false, error: body.error?.message || `HTTP ${res.status}` };
    }
    return { success: true, data: body.data };
  } catch {
    return { success: false, error: 'Network error — coba lagi' };
  }
}

const magicPasteService = { extract, getConfig, createPattern, updatePattern, deletePattern, updateSettings };

export default magicPasteService;
