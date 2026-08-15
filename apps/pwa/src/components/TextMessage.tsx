/** FASE 5 — default text rendering (used by TextMessage / fallback).
 *  BUG 1 fix: jangan paksa `text-foreground` di sini. Warna teks diwariskan dari
 *  parent bubble (MessageList.MessageBubble inline color / ChatBubble inline
 *  color) agar kontras WCAG AA terjaga — khususnya putih di bubble user hijau
 *  (#1E3A2B) yang sebelumnya ditimpa jadi #1C2420 (rasio ~1.28:1). */
export default function TextMessage({ text }: { text?: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm">{text ?? ''}</p>;
}
