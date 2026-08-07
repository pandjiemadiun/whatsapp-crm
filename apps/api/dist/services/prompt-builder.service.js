import { prisma } from '../infrastructure/prisma.js';
/**
 * PromptBuilderService — generates context-rich system prompts for AI assistants.
 */
export class PromptBuilderService {
    /**
     * Generate an initial system prompt for a store based on its profile data.
     */
    async generateInitialPrompt(storeId) {
        const store = await prisma.store.findUnique({
            where: { id: storeId, deletedAt: null },
            select: {
                name: true,
                businessCategory: true,
                address: true,
                operatingHours: true,
                acceptsTransfer: true,
                acceptsQris: true,
                acceptsCod: true,
                shippingMode: true,
                shippingFlatInCity: true,
                shippingFlatOutCity: true,
            },
        });
        if (!store) {
            throw new Error(`Store not found: ${storeId}`);
        }
        const payments = [];
        if (store.acceptsTransfer)
            payments.push('Transfer Bank');
        if (store.acceptsQris)
            payments.push('QRIS');
        if (store.acceptsCod)
            payments.push('COD');
        let shipping = ' belum dikonfigurasi';
        if (store.shippingMode === 'pickup') {
            shipping = ' Pengambilan langsung di toko';
        }
        else if (store.shippingMode === 'flat') {
            const parts = [];
            if (store.shippingFlatInCity !== null)
                parts.push(`Dalam kota Rp ${store.shippingFlatInCity.toLocaleString('id-ID')}`);
            if (store.shippingFlatOutCity !== null)
                parts.push(`Luar kota Rp ${store.shippingFlatOutCity.toLocaleString('id-ID')}`);
            shipping = ` Flat rate (${parts.join(', ')})`;
        }
        const hours = this.formatOperatingHours(store.operatingHours);
        const hoursStr = hours || '24 jam';
        const prompt = `Anda adalah asisten AI untuk ${store.name}, sebuah usaha ${store.businessCategory || 'niaga'} yang berlokasi di ${store.address || 'belum dilengkapi'}.
Jam operasional: ${hoursStr}.
Metode pembayaran: ${payments.length > 0 ? payments.join('/') : 'belum dikonfigurasi'}.
Metode pengiriman: ${shipping}.
Tugas Anda: Menjawab pertanyaan pelanggan dengan ramah, membantu memilih produk, dan memproses pesanan.`;
        return prompt;
    }
    /**
     * Save the generated system prompt to store_settings if not already set manually.
     */
    async saveInitialPromptIfMissing(storeId) {
        const existing = await prisma.storeSetting.findUnique({
            where: { storeId_key: { storeId, key: 'ai_system_prompt' } },
            select: { value: true },
        });
        if (existing && existing.value)
            return; // don't overwrite manual edits
        const prompt = await this.generateInitialPrompt(storeId);
        await prisma.storeSetting.upsert({
            where: { storeId_key: { storeId, key: 'ai_system_prompt' } },
            create: { storeId, key: 'ai_system_prompt', value: prompt },
            update: { value: prompt },
        });
    }
    formatOperatingHours(operatingHours) {
        if (!operatingHours || typeof operatingHours !== 'object')
            return null;
        if (typeof operatingHours.text === 'string' && operatingHours.text.trim()) {
            return operatingHours.text.trim();
        }
        const days = operatingHours.days || operatingHours;
        if (typeof days !== 'object' || Object.keys(days).length === 0)
            return null;
        const dayNames = {
            senin: 'Senin', selasa: 'Selasa', rabu: 'Rabu', kamis: 'Kamis',
            jumat: 'Jumat', sabtu: 'Sabtu', minggu: 'Minggu',
        };
        const lines = [];
        for (const [day, info] of Object.entries(days)) {
            if (typeof info !== 'object' || !info)
                continue;
            const d = info;
            if (d.open && d.close) {
                const label = dayNames[day.toLowerCase()] || day;
                lines.push(`${label} ${d.open}-${d.close}`);
            }
        }
        return lines.length > 0 ? lines.join(', ') : null;
    }
}
export const promptBuilderService = new PromptBuilderService();
//# sourceMappingURL=prompt-builder.service.js.map