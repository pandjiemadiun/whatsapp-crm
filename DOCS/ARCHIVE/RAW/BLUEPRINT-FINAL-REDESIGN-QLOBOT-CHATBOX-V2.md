# BLUEPRINT FINAL REDESAIN QLOBOT CHATBOX V2
## Merchant Storefront + Conversation Commerce + PWA Merchant App

**Status:** FINAL PRODUCT / UX / VISUAL DIRECTION

**Scope:** Fase 5 — redesign total pengalaman customer-facing Chatbox/PWA, dengan preservasi fondasi Fase 1–4.

---

# 1. NORTH STAR

## Prinsip tertinggi

> **JANGAN PERMALUKAN WEBSITE SAYA.**

Chatbox adalah gerbang pertama customer mengenal merchant dan QloBot. Karena itu visual adalah bagian dari produk, bukan kosmetik.

“Don't judge a book by its cover” tidak berlaku sebagai alasan untuk mengabaikan visual. Dalam konteks ini **cover sangat penting** karena customer dapat pergi sebelum pernah mengetahui seberapa canggih sistem di belakangnya.

### Product North Star

> **WhatsApp untuk komunikasi. Chatbox untuk pengalaman. PWA untuk menjadi toko.**

### UX North Star

> **Semudah chat, senyaman toko, secanggih aplikasi.**

### Design Principle

> **Sederhana di depan. Canggih di belakang.**

> **Easy to use. Impossible to embarrass.**

---

# 2. POSISI PRODUK

WhatsApp tetap menjadi pintu utama dan kanal komunikasi paling familiar.

QloBot **tidak menggantikan WhatsApp** dan tidak memaksa customer pindah.

Dua jalur hidup berdampingan:

```text
Customer
   │
   ├── WhatsApp
   │      └── komunikasi familiar
   │
   └── Chatbox
          ├── conversation
          ├── product discovery
          ├── visual catalog
          ├── cart
          ├── human assistance
          └── future checkout
```

Jika customer lebih nyaman memakai WhatsApp: **biarkan.**

Jika customer membuka Chatbox: **pengalaman harus terasa lebih kaya dan lebih nyaman daripada sekadar chat WhatsApp.**

Chatbox menjadi experience layer, bukan replacement channel.

---

# 3. PRODUCT DEFINITION

QloBot Chatbox bukan:

- WhatsApp clone.
- Chatbot dengan bubble yang dibuat lebih cantik.
- Mini marketplace yang penuh menu.

QloBot Chatbox adalah:

> **STOREFRONT YANG BISA DIAJAK NGOBROL.**

Conversation dan commerce adalah satu pengalaman.

```text
                MERCHANT STOREFRONT
                        │
          ┌─────────────┴─────────────┐
          │                           │
     CONVERSATION                 COMMERCE
          │                           │
     AI / Human               Product / Catalog
     Handoff                   Cart
     Typing                    Discovery
          │                           │
          └─────────────┬─────────────┘
                        │
                  ONE EXPERIENCE
```

Customer tidak perlu memikirkan apakah ia sedang “chat” atau “belanja”. Ia hanya merasa sedang berinteraksi dengan toko.

---

# 4. TARGET USER

## Customer

Persona ekstrem:

> **Orang awam, malas, gaptek, dan tidak mau belajar aplikasi baru.**

Target UX:

- tidak perlu membaca manual,
- tidak perlu memahami struktur aplikasi,
- tidak perlu menghafal menu,
- dapat menyelesaikan tugas dengan tap,
- dapat mengetik bila memang lebih nyaman,
- selalu punya next action yang jelas.

**User awam bukan alasan untuk membuat UI murahan.**

Yang disederhanakan adalah **beban berpikir**, bukan kualitas visual.

## Merchant

Merchant juga harus mudah mengoperasikan sistem.

Idealnya merchant dapat:

```text
Login
 ↓
lihat percakapan
 ↓
lihat yang perlu dibantu
 ↓
balas bila perlu
 ↓
selesai
```

Merchant tidak perlu memahami teknologi di baliknya.

---

# 5. DESIGN QUALITY BAR

Semua UI Fase 5 wajib memenuhi lima karakter sekaligus:

```text
PROFESSIONAL
    +
MODERN
    +
PREMIUM
    +
LIGHTWEIGHT
    +
EASY
```

## Tidak boleh

- flat putih seperti form tahun 2000-an,
- visual seperti CRUD/internal tool,
- generic chatbot template,
- childish/terlalu kartun,
- emoji dijadikan sistem icon utama,
- glassmorphism berlebihan,
- neon AI aesthetic,
- gradient berlebihan,
- shadow berat,
- terlalu banyak pill/badge,
- terlalu banyak menu,
- banyak ruang kosong tanpa fungsi.

## Yang diinginkan

- hierarchy visual kuat,
- typography matang,
- spacing konsisten,
- soft neutral surfaces,
- subtle elevation,
- merchant imagery yang menonjol,
- satu accent utama,
- CTA hierarchy yang jelas,
- motion ringan dan fungsional,
- product imagery menjadi visual anchor.

---

# 6. SUMBER REFERENSI DESAIN

Desain QloBot **tidak menyalin satu template**.

Kita memakai pola terbaik dari beberapa referensi lalu membangun design system QloBot sendiri.

## A. Shopify Shop Chat Agent — Conversational Commerce

Dipakai sebagai referensi untuk:

- natural-language product discovery,
- chat + store experience,
- commerce action yang muncul di conversation,
- future cart/checkout mindset.

Repo resmi:
https://github.com/Shopify/shop-chat-agent

Shopify menjelaskan project tersebut sebagai AI shopping assistant yang menggabungkan chat dengan product search, cart, checkout, dan order actions tanpa meninggalkan conversation. citeturn804401search0

**Yang diambil:** pola conversation commerce.

**Yang tidak diambil:** arsitektur backend atau branding Shopify.

## B. Storefront UI — Commerce Visual Language

Dipakai sebagai referensi untuk:

- ProductCard,
- quantity/control patterns,
- responsive storefront,
- accessible commerce primitives,
- component consistency.

Repo resmi:
https://github.com/vuestorefront/storefront-ui

Storefront UI adalah design system ecommerce berbasis Tailwind dengan reusable components, ProductCard/blocks, accessibility focus, dan Figma references. citeturn804401search1

**Yang diambil:** commerce patterns dan component quality.

**Yang tidak diambil:** seluruh library sebagai dependency wajib.

## C. Next Minimal Store — Premium Simplicity

Dipakai sebagai referensi:

- visual restraint,
- typography,
- whitespace yang purposeful,
- product presentation,
- responsive high-end storefront.

Template tersebut memosisikan dirinya sebagai minimalist e-commerce experience dengan fokus pada product presentation dan user experience. citeturn804401search2

**Yang diambil:** visual discipline.

**Yang tidak diambil:** layout toko penuh karena QloBot tetap conversation-first.

---

# 7. DESAIN DIBANGUN DARI PATTERN, BUKAN COPY TEMPLATE

Formula:

```text
Shopify Chat Agent
        +
Storefront UI
        +
Premium storefront patterns
        +
existing QloBot conversation foundation
        ↓
QLOBOT DESIGN SYSTEM
```

QloBot harus memiliki identitas sendiri.

---

# 8. FIRST-OPEN EXPERIENCE

First open adalah **cover** dan merupakan hard gate.

Dalam ≤5 detik user harus tahu:

1. Ini toko siapa.
2. Apa yang bisa dilakukan.
3. Bagaimana melihat produk.
4. Bagaimana bertanya.
5. Bahwa ini terlihat profesional.

## Target hierarchy

```text
Merchant identity
        ↓
Welcome / value proposition
        ↓
Primary action
        ↓
Secondary actions
        ↓
Product discovery
        ↓
Conversation
```

## Struktur konseptual

```text
┌──────────────────────────────┐
│ [LOGO]  MERCHANT NAME    🛒 │
│         Online / status     │
├──────────────────────────────┤
│                              │
│ Hai Kak 👋                   │
│ Mau cari apa hari ini?       │
│                              │
│ ┌──────────────────────────┐ │
│ │ 🔎 Cari produk...        │ │
│ └──────────────────────────┘ │
│                              │
│ Jelajahi toko                │
│ ┌──────────────────────────┐ │
│ │ 🛍 Lihat semua produk → │ │
│ └──────────────────────────┘ │
│                              │
│ Pilihan untukmu              │
│ ┌────────┐ ┌────────┐ →     │
│ │ IMAGE  │ │ IMAGE  │       │
│ │ Produk │ │ Produk │       │
│ │ Harga  │ │ Harga  │       │
│ └────────┘ └────────┘       │
│                              │
│ ┌──────────────────────────┐ │
│ │ 💬 Tanya toko            │ │
│ └──────────────────────────┘ │
│                              │
│ Tulis pesan...            ➤ │
└──────────────────────────────┘
```

**Ini information architecture, bukan pixel-final mockup.**

---

# 9. FIRST-OPEN HARD RULES

Customer tidak boleh wajib mengetik untuk memulai.

Minimal tersedia:

- Lihat Produk.
- Cari Produk.
- Tanya Toko.

Primary action hanya satu.

Jangan memberi tiga tombol dengan bobot visual sama.

---

# 10. PRODUCT DISCOVERY

Product browsing dasar **tidak harus menggunakan AI**.

Flow ideal:

```text
Tap “Lihat Produk”
        ↓
Public product catalog
        ↓
Product cards
```

AI tetap menjadi layer discovery yang powerful:

```text
Customer:
“Ada minyak 2 liter?”

AI:
“Ini beberapa yang tersedia 👇”

[Product] [Product]
```

Dua mode tersebut hidup berdampingan.

---

# 11. PRODUCT CARD

ProductCard bukan row database.

Visual hierarchy:

```text
IMAGE
↓
PRODUCT NAME
↓
PRICE
↓
STOCK
↓
ACTION
```

Card harus terasa seperti commerce surface.

Gunakan:

- aspect ratio konsisten,
- image containment/crop yang benar,
- price hierarchy kuat,
- stock sebagai secondary information,
- CTA jelas,
- lazy loading,
- fallback image.

Jangan mengarang:

- currency,
- stock,
- price,
- availability.

---

# 12. PRODUCT LIST

Mobile-first.

Prioritas:

- horizontal product rail untuk discovery ringan,
- grid ketika masuk full catalog,
- cukup informasi untuk mengambil keputusan,
- jangan membuat card terlalu padat.

Jika catalog besar, gunakan pagination/load-more sesuai contract backend yang sebenarnya.

---

# 13. SEARCH EXPERIENCE

Search harus terasa seperti commerce search, bukan input HTML generik.

```text
← Cari di MERCHANT

┌─────────────────────────────┐
│ 🔎 Kentang               × │
└─────────────────────────────┘

Hasil untuk “kentang”

[Product] [Product]
```

Empty state:

> Belum ketemu, Kak. Coba kata lain?

Bahasa manusia.

Tidak membuat filter/sorting kompleks yang belum memiliki backend authority.

---

# 14. CONVERSATION SHELL

Conversation tetap familiar dan tidak kehilangan fungsi dasar chat.

```text
Customer → right/brand accent
AI       → neutral left bubble
Human    → distinct agent treatment
System   → subtle system surface
```

Conversation bukan halaman terpisah dari commerce.

Product cards dapat muncul secara native di dalam conversation.

---

# 15. STRUCTURED MESSAGE VISUAL LANGUAGE

Specialized presentation tetap hanya untuk authoritative types:

- product,
- product_list,
- cart,
- quick_reply,
- handoff.

Unknown/unavailable type → text fallback.

UI tidak boleh menebak structured type dari string.

---

# 16. QUICK ACTIONS

Quick actions harus membantu user yang malas.

Tetapi jangan menggunakan terlalu banyak pill.

Gunakan hierarchy:

**Primary:** large contextual CTA.

**Secondary:** compact chips/buttons.

**Conversation quick replies:** muncul hanya ketika context membutuhkannya.

Icon boleh membantu, tetapi label tetap harus jelas.

---

# 17. CART

Cart merupakan contextual overlay, bukan aplikasi kedua.

Target:

```text
Chat
 ↓
🛒 badge
 ↓
Bottom Sheet / Drawer
```

Visual:

- item hierarchy,
- subtotal/total hierarchy,
- divider yang ringan,
- CTA yang jelas.

Jika checkout backend belum tersedia, **jangan fake checkout**.

Gunakan state yang jelas seperti:

> Checkout belum tersedia — hubungi admin untuk melanjutkan.

---

# 18. HUMAN HANDOFF

Human harus terlihat sebagai manusia, bukan AI yang berganti warna.

Contoh:

```text
Admin

Baik Kak, saya bantu cek dulu ya.
```

Handoff copy harus menggunakan bahasa manusia.

Jangan mengekspos internal status:

- human_takeover,
- resumed,
- resolved.

Customer menerima bahasa pengalaman, bukan terminology engine.

---

# 19. WHATSAPP BRIDGE

WhatsApp tetap first-class citizen.

Chatbox tidak mengatakan:

> Tinggalkan WhatsApp.

Sebaliknya:

> Chatbox memberi pengalaman tambahan yang lebih kaya.

Jika customer ingin kembali ke WhatsApp:

**tersedia.**

Target:

```text
Chatbox
   ├── AI
   ├── Products
   ├── Cart
   ├── Human
   └── WhatsApp
```

Exposure data WhatsApp harus minimal dan customer-facing.

Jangan expose gateway secrets/configuration.

---

# 20. CONNECTION UX

Technical state bukan user-facing jargon.

## Normal

Tidak ada banner.

## Reconnecting

> Menyambungkan kembali…

## HTTP masih hidup tapi WS reconnecting

Jangan membuat user mengira seluruh chat mati.

> Koneksi real-time sedang disambungkan kembali. Pesan masih bisa dikirim.

## Benar-benar gagal

> Koneksi sedang bermasalah. Coba lagi sebentar.

Setelah pulih:

> Koneksi kembali

lalu hilang otomatis.

Reliability adalah UX.

---

# 21. LOADING / EMPTY / ERROR

Gunakan UI state yang terasa seperti produk matang.

## Loading

Gunakan skeleton ringan, bukan plain `Memuat...`.

## Empty catalog

> Belum ada produk di sini.

CTA:

> Tanya Toko

## Search empty

> Belum ketemu, Kak. Coba kata lain?

## Error

Gunakan human-readable error surface.

Jangan expose error teknis.

---

# 22. PWA MERCHANT APP

Ini salah satu pembeda terbesar QloBot.

Saat customer install, experience harus terasa seperti:

```text
📱 [LOGO MERCHANT]
   MERCHANT NAME
```

Bukan:

```text
📱 QloBot
```

Merchant identity minimal:

- merchant name,
- short name bila diperlukan,
- merchant profile image/icon.

Current implementation menggunakan runtime merchant-branded manifest dan static fallback.

Browser-level install verification tetap wajib.

---

# 23. PWA RULES

- `start_url` tidak boleh mengarah ke `/` jika route aplikasi berada di `/c/`.
- scope `/c/` dipertahankan.
- Service Worker existing tetap owner.
- Jangan membuat Service Worker kedua.
- Manifest fallback harus tetap aman bila `/init` gagal.
- Merchant identity tidak boleh merusak installability.

Brand color dinamis **bukan requirement Fase 5 saat ini** dan tidak boleh memicu migration hanya demi kosmetik.

---

# 24. INSTALLED EXPERIENCE

Setelah install:

```text
Home screen
   ↓
Tap merchant icon
   ↓
langsung membuka merchant storefront
```

Tidak:

- QloBot splash generik,
- generic 404,
- wrong merchant,
- generic QloBot title.

---

# 25. VISUAL DESIGN TOKENS

Gunakan design system ringan.

## Surface

- warm/cool neutral background,
- white/high-contrast cards,
- subtle elevation,
- restrained borders.

## Radius

Gunakan radius yang modern tetapi tidak semua element menjadi pill.

- small: controls,
- medium: cards,
- large: hero/store surfaces,
- full: compact chips/avatar.

## Shadow

Soft, low-opacity, digunakan untuk hierarchy — bukan dekorasi.

## Typography

Prioritas:

1. Merchant identity
2. Headline/value proposition
3. Product name
4. Price
5. Secondary metadata

## Color

Neutral foundation + merchant identity + functional accent.

Jika merchant brand color belum authoritative, gunakan QloBot default accent yang konsisten.

---

# 26. ICONOGRAPHY

Gunakan icon system yang konsisten.

Emoji boleh sebagai content decoration, bukan sebagai fondasi icon system.

Fungsi penting wajib mempunyai:

- icon + label,
atau
- label yang sangat jelas.

Jangan membuat user menebak arti icon.

---

# 27. MICRO-INTERACTIONS

Motion harus menjelaskan state, bukan menjadi hiburan.

Boleh:

- subtle card entrance,
- sheet transition,
- cart badge change,
- typing pulse,
- connection transition,
- pressed/focus feedback.

Jangan:

- animation-heavy onboarding,
- excessive bouncing,
- unnecessary parallax,
- expensive visual effects.

---

# 28. MOBILE-FIRST

Baseline:

```text
Mobile → Tablet → Desktop
```

Requirements:

- thumb-friendly,
- tap target ≥ ~44px,
- composer keyboard-safe,
- product rails usable one-handed,
- cart sheet easy to dismiss,
- no hover-only interactions.

---

# 29. NAVIGATION

Jangan membuat marketplace navigation:

```text
Home | Products | Cart | Chat | Profile
```

Gunakan contextual navigation:

- back,
- cart badge,
- search,
- action CTA,
- conversation.

Satu layar harus mampu memberikan banyak capability tanpa banyak route.

---

# 30. PROGRESSIVE DISCLOSURE

Awalnya sedikit.

Detail muncul ketika dibutuhkan.

```text
Product Card
   ↓ tap
Product Detail / context
   ↓
Action
```

Jangan membanjiri user dengan semua informasi sejak awal.

---

# 31. ZERO-LEARNING TEST

User tidak boleh wajib mengetik untuk memulai pengalaman commerce.

Minimal test:

```text
Open
 ↓
Lihat Produk
 ↓
lihat product
 ↓
back
 ↓
Tanya Toko
```

Semua dapat dilakukan dengan tap.

---

# 32. FIVE-SECOND TEST

Dalam ≤5 detik:

- tahu ini toko siapa,
- tahu tindakan utama,
- tahu bagaimana melihat produk,
- tahu bagaimana bertanya,
- merasa halaman profesional.

Jika gagal → design revision.

---

# 33. MERCHANT PRIDE TEST

Pertanyaan utama:

> **Apakah merchant bangga mengirim link ini ke pelanggan?**

Scoring:

- Bangga → PASS+
- Tidak malu → PASS
- “Lumayan” → REVISION
- “Seperti website jadul” → FAIL

---

# 34. VISUAL QA REQUIREMENT

Code-level assessment tidak cukup.

Browser nyata wajib digunakan untuk final verification.

Recommended temporary QA tooling:

- Playwright,
- Chromium,
- atau tooling ringan yang setara.

Tool dapat dipasang sementara dan dibersihkan setelah Fase 5 selesai jika tidak lagi diperlukan.

Screenshot wajib dihasilkan untuk:

1. First open.
2. Product discovery.
3. Search.
4. Conversation.
5. Human reply/handoff.
6. Cart.
7. Connection state.
8. Installed/standalone PWA jika environment memungkinkan.

---

# 35. VISUAL QA CHECKLIST

### Professional
- [ ] terlihat seperti produk siap dipakai
- [ ] bukan CRUD/internal tool

### Modern
- [ ] typography matang
- [ ] hierarchy jelas
- [ ] spacing konsisten

### Premium
- [ ] surface/depth terasa refined
- [ ] product imagery menonjol
- [ ] merchant identity kuat

### Lightweight
- [ ] tidak terlalu banyak efek
- [ ] tidak banyak dependency baru hanya untuk visual
- [ ] responsive

### Easy
- [ ] next action jelas
- [ ] user tidak perlu belajar
- [ ] tap-first

### Embarrassment Test
- [ ] merchant mau membagikan link
- [ ] tidak terasa seperti template lama
- [ ] tidak terasa seperti prototype

---

# 36. BACKEND AUTHORITY RULE

Fase 5 boleh menyentuh backend **jika feature secara benar memang membutuhkan backend**.

Aturan:

```text
NEED
 ↓
VERIFY
 ↓
MINIMAL BACKEND CHANGE
 ↓
TEST
 ↓
REGRESSION
```

Jangan memaksakan semua fitur menjadi presentation-only.

Contoh valid:

- public product discovery membutuhkan `store.id` atau slug-based API,
- WhatsApp bridge membutuhkan minimal customer-facing destination.

Contoh invalid:

- menambah migration hanya untuk warna UI,
- memindahkan business authority ke frontend,
- membuat fake order/payment.

---

# 37. PROTECTED ARCHITECTURE

Tetap protected:

- Conversation Engine,
- WA gateway,
- EventBus core,
- Socket.IO foundation,
- notification architecture,
- persistence identity,
- tenant isolation,
- structured message authority.

Fase 5 boleh meminta backend change jika kebutuhan arsitektural nyata terbukti, tetapi perubahan harus minimal dan tidak merusak invariant.

---

# 38. IMPLEMENTATION ORDER

## F5.1
First impression + product discovery + merchant identity + WhatsApp bridge + PWA identity.

## F5.2
Conversation commerce visual polish.

## F5.3
Cart + contextual overlays + human handoff polish.

## F5.4
Composer + connection + loading/error + mobile polish.

## F5.5
PWA standalone experience + installability.

## F5.6
Final visual QA + regression + accessibility + performance.

Setiap slice harus diikuti:

- typecheck,
- build,
- relevant smoke tests,
- screenshot/browser QA bila UI berubah.

---

# 39. DEFERRED — JANGAN DIPAKSA MASUK FASE 5

- customer checkout backend,
- payment gateway,
- authoritative customer order API,
- payment confirmation backend,
- brandColor schema jika belum dibutuhkan,
- Fonnte device realtime (Fase 6).

UI boleh menyediakan future-ready presentation, tetapi tidak boleh fake state.

---

# 40. FINAL DEFINITION OF DONE

Fase 5 belum selesai hanya karena build/test hijau.

Fase 5 dianggap selesai jika:

### Customer
- [ ] bisa masuk tanpa belajar,
- [ ] bisa melihat produk tanpa mengetik,
- [ ] bisa mencari produk,
- [ ] bisa chat,
- [ ] bisa memahami AI vs human,
- [ ] dapat berpindah ke WhatsApp bila mau,
- [ ] cart mudah dipahami,
- [ ] connection state tidak membingungkan.

### Merchant
- [ ] branding terasa milik merchant,
- [ ] link layak dibagikan,
- [ ] tidak terlihat seperti generic chatbot.

### PWA
- [ ] install tidak 404,
- [ ] merchant name/icon benar,
- [ ] start_url benar,
- [ ] scope benar,
- [ ] standalone experience benar.

### Visual
- [ ] professional,
- [ ] modern,
- [ ] premium,
- [ ] lightweight,
- [ ] tidak flat/boring,
- [ ] tidak childish,
- [ ] tidak “2000s form”,
- [ ] tidak memalukan.

### Technical
- [ ] F1 regression pass,
- [ ] F2 regression pass,
- [ ] F3 regression pass,
- [ ] F4 regression pass,
- [ ] tenant isolation pass,
- [ ] persistence invariant pass,
- [ ] structured authority preserved,
- [ ] no fake commerce state.

---

# 41. FINAL PRODUCT STATEMENT

> **QloBot Chatbox adalah storefront yang bisa diajak ngobrol.**

WhatsApp tetap menjadi pintu utama komunikasi.

Chatbox memberikan pengalaman belanja yang lebih kaya.

PWA membuat pengalaman tersebut terasa seperti aplikasi milik merchant.

Customer tidak perlu belajar.
Merchant tidak perlu malu.

**Simple in the hand. Sophisticated underneath.**
