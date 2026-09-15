#!/bin/bash
# Idempotent seed: creates/reuses category + upserts 3 products for store-a3cd7205
set -a && source /home/ubuntu/garuda/.env && set +a
STORE_ID="store-a3cd7205"

# Get or create category
CAT_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM product_categories WHERE \"storeId\" = '$STORE_ID' AND name = 'Spare Parts' AND \"deletedAt\" IS NULL;" 2>&1 | tr -d '[:space:]')
if [ -z "$CAT_ID" ]; then
  CAT_ID=$(psql "$DATABASE_URL" -t -c "INSERT INTO product_categories (\"storeId\", name, \"displayOrder\", \"createdAt\", \"updatedAt\") VALUES ('$STORE_ID', 'Spare Parts', 1, NOW(), NOW()) RETURNING id;" 2>&1 | tr -d '[:space:]')
  echo "Created category: $CAT_ID"
else
  echo "Category exists: $CAT_ID"
fi

# Upsert products by (storeId, sku) — uses gen_random_uuid() for new inserts
psql "$DATABASE_URL" -c "
  INSERT INTO products (\"storeId\", \"categoryId\", id, name, price, \"sku\", stock, \"isActive\", \"createdAt\", \"updatedAt\")
  VALUES 
    ('$STORE_ID', '$CAT_ID', gen_random_uuid(), 'Busi Motor', 15000, 'BUSI-MOTOR-V2', 50, true, NOW(), NOW()),
    ('$STORE_ID', '$CAT_ID', gen_random_uuid(), 'Ban Dalam Motor', 50000, 'BAN-DALAM-V2', 100, true, NOW(), NOW()),
    ('$STORE_ID', '$CAT_ID', gen_random_uuid(), 'Oli Mesin', 75000, 'OLI-MESIN-V2', 30, true, NOW(), NOW())
  ON CONFLICT (\"storeId\", sku) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock = EXCLUDED.stock,
    \"isActive\" = true,
    \"deletedAt\" = NULL,
    \"updatedAt\" = NOW();
" 2>&1

echo ""
echo "=== Product count ==="
psql "$DATABASE_URL" -t -c "SELECT count(*) FROM products WHERE \"storeId\"='$STORE_ID' AND \"isActive\"=true AND \"deletedAt\" IS NULL;"
