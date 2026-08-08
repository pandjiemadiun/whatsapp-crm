/**
 * Prompt Template v2 — BAGIAN 1 (v3.2)
 * src/services/chat/prompts-v2.ts
 *
 * Builder untuk system prompt + user prompt LLM interpreter v3.2, beserta
 * 6 contoh transkrip (few-shot) sebagai konstanta terpisah.
 *
 * I8: artefak prompt ini tidak memanggil model — hanya memproduksi string
 *     yang dikirimkan ke interpreter (stage 4, LLM).
 */
// ─────────────────────────────────────────────────────────────────────────────
// buildSystemPrompt
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Buat system prompt utama. Memuat:
 *   - 11 aturan eksplisit (rule a..k) yang wajib dipatuhi interpreter, dan
 *   - daftar nama produk dari katalog (dibaca dari parameter, bukan hardcoded).
 */
export function buildSystemPrompt(catalog) {
    const productNames = catalog.length
        ? catalog.map((c) => c.name).join(', ')
        : '(belum ada katalog)';
    return `Anda adalah interpreter v3.2 untuk sistem order makanan. Tugas Anda: ubah pesan user + konteks menjadi satu objek JSON yang valid sesuai InterpreterResultV2.

========== ATURAN (WAJIB DITEGAKKAN) ==========
a. HANYA JSON valid sesuai InterpreterResultV2 — jangan sertakan teks, markdown, atau penjelasan di luar JSON.
b. JANGAN sertakan harga/stok di reply_draft; reply_draft maksimal 2 kalimat.
c. Setiap entitas produk yang user sebut WAJIB muncul di acts[].entities ATAU di unmatched_mentions. Jangan pernah diam-diam menghilangkan sebuah mention.
d. qty_source: 'explicit' HANYA jika teks user menyebut angka/satuan (misal '2 kg' atau '1 buah'). Jika tidak eksplisit, isi 'default' dan biarkan qty=null.
e. JANGAN mengisi field yang tidak ada bukti di percakapan (anti-hallucination).
f. Selection dinyatakan sebagai SetOp (ALL/NAMES/INDICES/FILTER_CATEGORY/FILTER_PRICE_RANK/MINUS/LAST_REPEAT), bukan teks bebas.
g. Revisi dalam satu kalimat: buat act baru dengan supersedes mengacu pada act_id yang direvisi. Contoh: 'es teh 1, eh gajadi es jeruk aja' → 2 acts, act kedua punya supersedes=act_id pertama.
h. Quantifier: resolution_type salah satu dari exact|subset|ambiguous|mismatch. Jika resolution_type=mismatch, WAJIB isi mismatch_reason.
i. confidence per dimensi (entities/intent/selection/topic) angka 0–1.
j. Jika ada pending active dan pesan user bukan jawaban confirmation → topic_switch=true.
k. summary_update: 1–2 kalimat ringkasan state percakapan setelah pesan ini.

========== KATALOG PRODUK ==========
Produk yang tersedia di katalog: ${productNames}

========== CONTOH (FEW-SHOT) ==========
Lihat konstanta FEW_SHOTS untuk 6 contoh transkrip permintaan yang diharapkan.`;
}
// ─────────────────────────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Buat user prompt: gabungan pesan user, ringkasan workspace (summary +
 * pending aktif + opsi terakhir), dan riwayat conversasi.
 */
export function buildUserPrompt(message, workspace, history) {
    const summary = workspace.conversation_summary || '(belum ada ringkasan)';
    const activePendings = workspace.pendings.filter((p) => p.status === 'active');
    const pendingInfo = activePendings.length
        ? activePendings.map((p) => `- ${p.id}: ${p.question}`).join('\n')
        : '(tidak ada pending aktif)';
    const lastOptions = workspace.options_presented.slice(-1)[0] ?? [];
    const histLines = history.length
        ? history.map((h) => `[${h.role}] ${h.content}`).join('\n')
        : '(belum ada riwayat)';
    return `========== PESAN USER ==========
${message}

========== RINGKASAN WORKSPACE ==========
conversation_summary: ${summary}
pending aktif:
${pendingInfo}
opsi yang pernah disajikan (turn terakhir): ${JSON.stringify(lastOptions)}

========== RIWAYAT KONVERSAI ==========
${histLines}

Kembalikan respons HANYA sebagai JSON yang valid sesuai InterpreterResultV2 (lihat system prompt).`;
}
// ─────────────────────────────────────────────────────────────────────────────
// FEW_SHOTS (6 contoh transkrip untuk dilatih interpreter)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 6 contoh (user_message + konteks + expected_json) yang memandu interpreter:
 *   1. multi-act 3 produk — tidak ada product mention yang missing.
 *   2. revisi dalam satu kalimat — act kedua punya supersedes=act_id pertama.
 *   3. topic switch — pending aktif + user tanya di luar scope order.
 *   4. quantifier mismatch — user merujuk opsi ketiga yang tidak ada.
 *   5. afirmasi ambigu — "iya" pada 4 opsi, butuh clarification.
 *   6. multi-add dalam satu kalimat — 3 produk qty 1 eksplisit, confidence tinggi.
 */
export const FEW_SHOTS = [
    {
        user_message: 'Mau es teh 1, Es jeruk 1, Tambah kentang 1 ya',
        context_description: 'Customer order 3 produk sekaligus (multi-act). Semua product mention harus masuk acts[].entities; tidak ada yang boleh missing.',
        expected_json: `{
  "acts": [
    {"act_id":"act_es_teh","intent":"cart_update","entities":[{"type":"product","value":"es teh","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null},
    {"act_id":"act_es_jeruk","intent":"cart_update","entities":[{"type":"product","value":"es jeruk","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null},
    {"act_id":"act_kentang","intent":"cart_update","entities":[{"type":"product","value":"kentang","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null}
  ],
  "unmatched_mentions": [],
  "topic_switch": false,
  "draft_cart_ops": [],
  "confidence": {"entities":0.9,"intent":0.9,"selection":0.95,"topic":0.9},
  "summary_update": "Customer menambahkan es teh, es jeruk, dan kentang ke keranjang."
}`,
    },
    {
        user_message: 'eh gajadi es teh, es jeruk aja',
        context_description: 'Customer merevisi order dalam satu kalimat: batalkan es teh, ganti jadi es jeruk.',
        expected_json: `{
  "acts": [
    {"act_id":"act_es_teh_v1","intent":"cart_update","entities":[{"type":"product","value":"es teh","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null},
    {"act_id":"act_es_jeruk_v1","intent":"cart_update","entities":[{"type":"product","value":"es jeruk","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":"act_es_teh_v1"}
  ],
  "unmatched_mentions": [],
  "topic_switch": false,
  "draft_cart_ops": [],
  "confidence": {"entities":0.9,"intent":0.9,"selection":0.9,"topic":0.9},
  "summary_update": "Customer merevisi: es teh diganti dengan es jeruk."
}`,
    },
    {
        user_message: 'ongkir ke jakarta berapa?',
        context_description: 'Pending active bertanya "Mau pesan apa?"; user beralih ke pertanyaan ongkir (bukan jawaban confirmation) -> topic_switch.',
        expected_json: `{
  "acts": [
    {"act_id":"act_ongkir","intent":"info_answer","entities":[{"type":"destination","value":"jakarta","confidence":0.85}],"qty":null,"qty_source":"default","confidence":0.85,"supersedes":null}
  ],
  "unmatched_mentions": [],
  "topic_switch": true,
  "draft_cart_ops": [],
  "quantifier": {"resolution_type":"exact","resolved_indices":[0]},
  "confidence": {"entities":0.85,"intent":0.7,"selection":0.8,"topic":0.7},
  "summary_update": "Customer beralih ke pertanyaan ongkir ke Jakarta; pending konfirmasi tetap aktif."
}`,
    },
    {
        user_message: 'ketiganya',
        context_description: 'Opsi yang disajikan [X, Y] (N=2); user merujuk "ketiganya" (index 2) yang tidak ada -> mismatch.',
        expected_json: `{
  "acts": [],
  "unmatched_mentions": [],
  "topic_switch": false,
  "draft_cart_ops": [],
  "quantifier": {"resolution_type":"mismatch","resolved_indices":[2],"mismatch_reason":"ketiganya merujuk index 2, tapi opsi hanya ada 2 (index 0,1)"},
  "confidence": {"entities":0.5,"intent":0.5,"selection":0.5,"topic":0.5},
  "summary_update": "Customer merujuk opsi ketiga (ketiganya) yang tidak ada di daftar pilihan."
}`,
    },
    {
        user_message: 'iya',
        context_description: 'Opsi [A, B, C, D] (N=4) disajikan; user hanya bilang "iya" secara ambigu -> clarification.',
        expected_json: `{
  "acts": [],
  "unmatched_mentions": [],
  "topic_switch": false,
  "draft_cart_ops": [],
  "quantifier": {"resolution_type":"ambiguous","resolved_indices":[]},
  "clarification": {"question":"Mau pilih yang mana dari A/B/C/D?","options":["A","B","C","D"],"expected_type":"choice"},
  "confidence": {"entities":0.3,"intent":0.3,"selection":0.3,"topic":0.3},
  "summary_update": "Customer mengonfirmasi secara ambigu pada 4 opsi; butuh klarifikasi."
}`,
    },
    {
        user_message: 'Aku mau kangkung 1, wortel 1, kentang 1 ya',
        context_description: 'Customer order 3 produk sekaligus (multi-add) dalam satu kalimat; semua product mention masuk acts[].entities, qty=1 eksplisit, confidence tinggi.',
        expected_json: `{
  "acts": [
    {"act_id":"act_kangkung","intent":"cart_update","entities":[{"type":"product","value":"kangkung","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null},
    {"act_id":"act_wortel","intent":"cart_update","entities":[{"type":"product","value":"wortel","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null},
    {"act_id":"act_kentang","intent":"cart_update","entities":[{"type":"product","value":"kentang","confidence":0.9}],"qty":1,"qty_source":"explicit","confidence":0.9,"supersedes":null}
  ],
  "unmatched_mentions": [],
  "topic_switch": false,
  "draft_cart_ops": [],
  "confidence": {"entities":0.9,"intent":0.9,"selection":0.95,"topic":0.9},
  "summary_update": "Customer menambahkan kangkung, wortel, dan kentang ke keranjang."
}`,
    },
];
//# sourceMappingURL=prompts-v2.js.map