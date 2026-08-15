/** Stock badge rendered from the AUTHORITATIVE payload value (no fabrication). */
export default function StockBadge({ stock }: { stock: number | null }) {
  if (stock === null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        aria-label="Stok tidak terbatas"
        title="Stok tidak terbatas"
      >
        Stok tidak terbatas
      </span>
    );
  }
  if (stock === 0) {
    return (
      <span className="text-xs text-destructive font-medium" aria-label="Stok habis">
        Stok habis
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" title={`Stok tersedia: ${stock}`}>
      Stok: {stock}
    </span>
  );
}
