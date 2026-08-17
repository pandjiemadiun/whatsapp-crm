export enum ResponseSource {
  CACHE = 'cache',
  FAQ = 'faq',
  KNOWLEDGE = 'knowledge',
  AI = 'ai',
  HUMAN = 'human',
  FALLBACK = 'fallback',
  DEAD_END = 'dead_end',
PRODUCT = 'product',
  CATALOG = 'catalog',
  PAYMENT = 'payment',
  SHIPPING = 'shipping',
  SOP = 'sop',
  ORDER_STATUS = 'order_status',
  TOTAL = 'total',
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sender: 'customer' | 'assistant' | 'human_agent';
  content: string;
  source?: ResponseSource;
  cost?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface ConversationContext {
  storeId: string;
  customerId: string;
  conversationId: string;
  messages: ConversationMessage[];
  lastMessageAt: Date;
  status: 'active' | 'resolved' | 'escalated';
}

export interface ResponseOption {
  source: ResponseSource;
  content: string;
  confidence: number;
  cost: number;
  metadata?: Record<string, any>;
}

export interface ResponseResult {
  conversationId: string;
  message: ConversationMessage;
  source: ResponseSource;
  confidence: number;
  cost: number;
  requiresHumanReview: boolean;
  metadata?: Record<string, any>;
}

export interface ConversationStats {
  conversationId: string;
  totalMessages: number;
  sourceDistribution: Record<ResponseSource, number>;
  totalCost: number;
  averageResponseTime: number;
}

// ============================================================
// Phase 1.9.2 — Conversation Context & Product Catalog types
// ============================================================

/**
 * Nilai JSON yang diterima Prisma untuk kolom bertipe Json.
 */
export type PrismaJsonValue = string | number | boolean | null | PrismaJsonValue[] | { [key: string]: PrismaJsonValue };

/**
 * Tipe entitas yang berhasil diekstrak dari pesan pelanggan
 * (mis. nama produk, jumlah, alamat tujuan, intent transaksi).
 */
export interface ExtractedEntity {
  /** Jenis entitas: 'product' | 'quantity' | 'destination' | 'order' | 'intent' | custom */
  type: string;
  /** Nilai mentah hasil ekstraksi */
  value: string;
  /** Skor keyakinan 0..1 — nilai lebih tinggi menang saat merge */
  confidence: number;
  /** Metadata tambahan opsional (mis. productId hasil lookup) */
  metadata?: Record<string, unknown>;
}

/**
 * Payload inisialisasi context percakapan.
 */
export interface ConversationContextInput {
  storeId: string;
  customerId: string;
  conversationId: string;
  /** Durasi sesi dalam menit (default 60) */
  sessionExpireMinutes?: number;
}

/**
 * Data context percakapan lengkap yang dipetakan dari tabel
 * conversation_context.
 */
export interface ConversationContextData {
  id: string;
  conversationId: string;
  /** Riwayat pesan terakhir (maks 10) */
  lastMessages: ConversationMessage[];
  /** Entitas yang sudah diekstrak dari percakapan */
  extractedEntities: ExtractedEntities;
  /** Intent pengguna terakhir yang terdeteksi */
  userIntent: string | null;
  /** Kunci sesi unik (SHA256 dari conversationId + timestamp) */
  sessionKey: string;
  /** Waktu kedaluwarsa sesi */
  sessionExpireAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Kategori produk milik sebuah toko.
 */
export interface ProductCategory {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Gambar produk (disimpan sebagai array di kolom images Json).
 */
export interface ProductImage {
  id: string;
  url: string;
  uploadedAt: Date;
}

/**
 * Produk dalam katalog toko.
 */
export interface Product {
  id: string;
  storeId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  sku: string | null;
  /** null = stok tidak terbatas */
  stock: number | null;
  images: ProductImage[] | null;
  primaryImageUrl: string | null;
  isActive: boolean;
  /** Sumber pembuatan: 'api' | 'magic_paste' | 'import' */
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Item pesanan (baris detail order).
 */
export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  customizations: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pesanan lengkap beserta item-itemnya.
 */
export interface OrderWithItems {
  id: string;
  storeId: string;
  conversationId: string;
  customerId: string;
  totalPrice: number | null;
  currency: string;
  orderStatus: string;
  shippingAddress: string | null;
  notes: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
}

/**
 * Input pembuatan pesanan dari katalog produk.
 */
export interface OrderItemInput {
  productId: string;
  quantity: number;
  customizations?: Record<string, unknown>;
}

/**
 * Percakapan lengkap beserta context dan pesanan.
 */
export interface ConversationWithContext {
  id: string;
  storeId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  status: string;
  channel: string;
  lastMessageAt: Date | null;
  aiResponseCount: number;
  faqResponseCount: number;
  createdAt: Date;
  updatedAt: Date;
  context: ConversationContextData | null;
  orders: OrderWithItems[];
}

/**
 * Item yang sudah dibahas (mentioned) dalam percakapan,
 * belum tentu dikonfirmasi oleh pelanggan.
 */
export interface DiscussedItem {
  product: string;
  qty: string | number | null;
  price: number | null;
  unit?: string;
  mentionedAt: string; // ISO timestamp
}

/**
 * Item yang sudah dikonfirmasi oleh pelanggan.
 * Extends DiscussedItem dengan waktu konfirmasi.
 */
export interface ConfirmedItem extends DiscussedItem {
  confirmedAt: string;
}

/**
 * Bentuk data yang disimpan di kolom `extractedEntities`
 * pada tabel conversation_context (jsonb, untyped di DB level).
 */
export interface ExtractedEntities {
  discussedItems: DiscussedItem[];
  confirmedItems: ConfirmedItem[];
  lastAmbiguousPrompt: string | null;
  recipientName?: string | null;
  shippingAddress?: string | null;
  /** BAGIAN 2 — Pending clarification state (resolver cycle) */
pendingClarification?: PendingClarification | null;
  /** BAGIAN 2.4 — Snapshot sebelum cart mutation (untuk rollback) */
  previousMutation?: { cartSnapshot: ConfirmedItem[]; message: string } | null;
  /** Tok entitas mentah (product/order/quantity/destination) yang diekstrak — dilacak per-conversation */
  trackedEntities?: ExtractedEntity[];
}

/**
 * Item keranjang yang dimanipulasi oleh cart_ops (dari LLM atau resolver).
 * Harga TIDAK dipercaya dari LLM — selalu diambil dari DB saat eksekusi.
 */
export interface CartOp {
  type: 'add' | 'remove';
  product: string;
  qty?: number;
  price?: number;       // hint saja — akan diganti dengan harga DB
}

/** Opsi clarification untuk pending state */
export interface ClarificationOption {
  id: string;
  label: string;
  cartOps?: CartOp[];
  action?: string;
}

/**
 * State clarification yang sedang pending — resolver cycle (BAGIAN 2).
 * Disimpan di extractedEntities.pendingClarification.
 */
export interface PendingClarification {
  id?: string;
  type?: string;
  question: string;
  options: ClarificationOption[];
  expected_type: 'affirmative' | 'choice' | 'yes_no';
  snapshot?: object;
  asked_at: string;
  retry_count: number;
  rawOptions?: string[];      // legacy: flat string options (backward compat)
  rawExpectedType?: 'yes_no' | 'choice_multi';
}

/**
 * Hasil resolver — aksi yang dieksekusi setelah clarifying question dijawab.
 */
export interface ResolvedAction {
  /** true = afirmatif (yes/yes-to-all) → eksekusi cart_ops */
  approved: boolean;
  /** nama produk yang dipilih dari options */
  selectedProducts?: string[];
}

/** Hasil dari resolver clarification */
export interface ResolverResult {
  status: 'RESOLVED' | 'NEED_RETRY' | 'ESCALATE' | 'NOT_PENDING_ANSWER';
  cartOps?: CartOp[];
  message?: string;
}

/**
 * Output satu panggilan interpreter (BAGIAN 3).
 */
export interface InterpreterResult {
  intent: 'product_info' | 'total' | 'buy' | 'smalltalk' | 'clarify';
  cart_ops: CartOp[];
  buy_signal: 'yes' | 'no' | 'maybe';
  order_extract: { order_id?: string } | null;
  missing_info: string[] | null;
  identity: { name: string | null } | null;
  reply_draft: string | null;
  confidence: number;
  clarification: {
    question: string;
    options: ClarificationOption[];
    expected_type: 'affirmative' | 'choice' | 'yes_no';
  } | null;
}

/**
 * PipelineContext — runtime context yang dibawa sepanjang 5-stage pipeline.
 * Dibangun sekali di awal processCustomerMessage, tidak persisted ke DB.
 */
export interface PipelineContext {
  storeId: string;
  customerId: string;
  conversationId: string;
  messages: ConversationMessage[];
  customerCity: string | null;
  customerName: string | null;
  cart: ConfirmedItem[];
  activeOrder: { orderStatus: string; items: any[] } | null;
  pendingClarification: PendingClarification | null;
  llmCalledThisTurn: boolean;
  storeProducts: Array<{ name: string; price: number; stock: number | null }>;
}

/**
 * Skema fungsi AI untuk integrasi function-calling LLM.
 */
export interface AIFunctionSchema {
  /** Nama fungsi yang dipanggil model */
  name: string;
  /** Deskripsi tujuan fungsi */
  description: string;
  /** Skema parameter JSON (format JSON Schema) */
  parameters: Record<string, unknown>;
}

/**
 * Hasil eksekusi fungsi AI.
 */
export interface AIFunctionResult {
  name: string;
  /** Data hasil (parsed JSON) */
  data: unknown;
  /** Pesan error jika eksekusi gagal */
  error?: string;
}

export enum AuditAction {
  STORE_SUSPENDED = 'store_suspended',
  STORE_ACTIVATED = 'store_activated',
  STORE_PASSWORD_RESET = 'store_password_reset',
  STORE_EMAIL_VERIFIED = 'store_email_verified',
  FONNTE_DISCONNECTED = 'fonnte_disconnected',
  CONFIG_UPDATED = 'config_updated',
  CONFIG_DELETED = 'config_deleted',
}
