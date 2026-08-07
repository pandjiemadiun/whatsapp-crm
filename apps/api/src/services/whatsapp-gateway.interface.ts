export interface SendMessageConfig {
  token?: string;
  typing?: boolean;
  inboxid?: number;
  deviceId?: string;
  [key: string]: any;
}

export interface IWhatsAppGateway {
  sendMessage(phone: string, text: string, config?: SendMessageConfig): Promise<any>;
  /** Optional: send image via URL */
  sendImage?: (phone: string, imageUrl: string, caption?: string) => Promise<any>;
  /** Optional: mark message as read (untuk presensi simulasi) */
  markRead?: (phone: string, deviceId?: string) => Promise<void>;
  /** Optional: set presence state (composing/paused/none) */
  setPresence?: (phone: string, state: 'composing' | 'paused' | 'none', deviceId?: string) => Promise<void>;
  /** Optional: fetch customer profile */
  fetchProfile?: (phone: string) => Promise<any>;
}
