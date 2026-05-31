// scripts/backfill-customers.js
// Liên kết các nợ vé / hộ chiếu CŨ (customer_id IS NULL) với bảng customers:
// tạo khách hàng nếu chưa có (theo SĐT, rồi theo tên) và gán customer_id.
// Chạy: npm run backfill
require('dotenv').config();
const pool = require('../config/database');
const logger = require('../config/logger');
const { upsertCustomer } = require('../utils/importHelpers');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let dCount = 0;
    let pCount = 0;

    const debts = await client.query(
      `SELECT id, user_id, customer_name, phone_number
       FROM debts WHERE customer_id IS NULL AND customer_name IS NOT NULL AND customer_name <> ''`
    );
    for (const d of debts.rows) {
      const cid = await upsertCustomer(client, d.user_id, {
        name: d.customer_name, phone: d.phone_number, type: 'individual',
      });
      if (cid) {
        await client.query('UPDATE debts SET customer_id = $1 WHERE id = $2', [cid, d.id]);
        dCount += 1;
      }
    }

    const passports = await client.query(
      `SELECT id, user_id, customer_name, phone_number, address
       FROM passports WHERE customer_id IS NULL AND customer_name IS NOT NULL AND customer_name <> ''`
    );
    for (const p of passports.rows) {
      const cid = await upsertCustomer(client, p.user_id, {
        name: p.customer_name, phone: p.phone_number, address: p.address, type: 'individual',
      });
      if (cid) {
        await client.query('UPDATE passports SET customer_id = $1 WHERE id = $2', [cid, p.id]);
        pCount += 1;
      }
    }

    await client.query('COMMIT');
    logger.info(`✅ Backfill xong: liên kết ${dCount} nợ vé + ${pCount} hộ chiếu với khách hàng.`);
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Backfill thất bại:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
})();
