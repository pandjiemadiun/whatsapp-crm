export DATABASE_URL="postgresql://garuda_user:your_db_password@127.0.0.1:5432/garuda_dev"
npx tsx --env-file ../../.env --test --test-force-exit src/tests/ot-percakawan.test.ts 2>&1 | tail -8
