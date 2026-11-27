// utils/cancel.js — Huỷ / hoàn vé cho cả 4 dịch vụ + đổi vé máy bay (Dòng tiền v3.1, docs/MONEY-FLOWS.md).
//
// Huỷ (1 transaction):
//   1. original_amount = giá bán hiện tại (nếu chưa có); giá bán = finalAmount (phí khách chịu);
//      status = 'cancelled', cancelled_at, cancel_note.
//   2. Hoàn tiền khách: payments { kind:'refund', amount: −X } (+ wallet_entries 'credit' +X nếu hoàn vào ví).
//   3. Giữ giá vốn cũ thành 1 dòng "Giá vốn" (nếu chưa có dòng nào); mỗi NCC hoàn → cost_items kind 'refund'
//      (amount âm) + supplier_payments âm nếu đã nhận ngay. cost_amount = Σ dòng.
// Hoàn tác huỷ: xoá đúng những gì bước huỷ tạo ra → mọi con số về như trước.
const pool = require('../config/database');
const logger = require('../config/logger');
const v = require('./validate');
const { logAudit } = require('./audit');
const { assertOwns } = require('./ownership');
const { assertAccount, recomputeCostItemPaid, syncCostAmount, loadServiceRow } = require('./costItems');
const { lockWallet, walletBalance, fmtVnd } = require('./money');
const { service, lockService, recomputeServicePaid, round2 } = require('./services');
const { todayLocal } = require('./dates');

const MAX_SUPPLIER_REFUNDS = 20;

function parseCancelBody(body) {
  const cancelDate = v.dateStr(body.cancelDate, { label: 'Ngày huỷ' }) || todayLocal();
  const note = v.str(body.note, { label: 'Ghi chú huỷ' });
  const finalAmount = v.amount(body.finalAmount, { label: 'Số tiền khách chịu' }) ?? 0;

  let customerRefund = null;
  if (body.customerRefund !== undefined && body.customerRefund !== null) {
    const cr = body.customerRefund;
    if (typeof cr !== 'object' || Array.isArray(cr)) throw new v.ValidationError('Hoàn tiền khách không hợp lệ');
    customerRefund = {
      amount: v.amount(cr.amount, { label: 'Số tiền hoàn khách' }), // null = tự tính
      to: v.oneOf(cr.to, ['wallet', 'account'], { label: 'Hoàn vào' }),
      accountId: v.int(cr.accountId, { min: 1, label: 'Tài khoản hoàn' }),
    };
  }

  const rawSr = body.supplierRefunds;
  if (rawSr !== undefined && rawSr !== null && !Array.isArray(rawSr)) throw new v.ValidationError('Danh sách NCC hoàn không hợp lệ');
  const list = rawSr || [];
  if (list.length > MAX_SUPPLIER_REFUNDS) throw new v.ValidationError(`Tối đa ${MAX_SUPPLIER_REFUNDS} dòng NCC hoàn`);
  const supplierRefunds = list.map((s, i) => {
    const p = `NCC hoàn ${i + 1}`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new v.ValidationError(`${p} không hợp lệ`);
    const amount = v.num(s.amount, { required: true, label: `${p}: số tiền` });
    if (amount <= 0) throw new v.ValidationError(`${p}: số tiền phải lớn hơn 0`);
    return {
      supplierId: v.int(s.supplierId, { min: 1, required: true, label: `${p}: nhà cung cấp` }),
      amount: round2(amount),
      receivedNow: v.bool(s.receivedNow, { label: `${p}: đã nhận` }) === true,
      accountId: v.int(s.accountId, { min: 1, label: `${p}: tài khoản nhận` }),
    };
  });
  return { cancelDate, note, finalAmount: round2(finalAmount), customerRefund, supplierRefunds };
}

/** Dịch vụ chưa có dòng giá vốn mà cost_amount > 0 → tạo 1 dòng "Giá vốn" để giữ nguyên giá trị. */
async function ensureBaseCostItem(client, userId, type, row) {
  const s = service(type);
  const has = await client.query(`SELECT 1 FROM cost_items WHERE ${s.payCol} = $1 LIMIT 1`, [row.id]);
  if (has.rows.length === 0 && Number(row.cost_amount) > 0) {
    await client.query(
      `INSERT INTO cost_items (user_id, ${s.payCol}, label, amount, position, kind) VALUES ($1, $2, 'Giá vốn', $3, 0, 'cost')`,
      [userId, row.id, row.cost_amount]
    );
  }
}

async function nextPosition(client, type, id) {
  const s = service(type);
  const r = await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM cost_items WHERE ${s.payCol} = $1`, [id]);
  return r.rows[0].pos;
}

/** POST /api/{debts|passports|train-tickets|tours}/:id/cancel */
function makeCancelHandler(type) {
  const s = service(type);
  return async (req, res) => {
    const id = v.idParam(req.params.id);
    const b = parseCancelBody(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await lockService(client, type, id, req.user.id);
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
      }
      if (row.is_cancelled) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Dịch vụ đã huỷ rồi' });
      }

      // --- Hoàn tiền khách
      const paid = round2(row.paid_total);
      const cr = b.customerRefund || {};
      const refundAmount = cr.amount !== null && cr.amount !== undefined ? round2(cr.amount) : Math.max(0, round2(paid - b.finalAmount));
      if (refundAmount > paid) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Không hoàn quá số khách đã trả (${fmtVnd(Math.max(0, paid))})` });
      }
      const to = cr.to || (row.customer_id ? 'wallet' : 'account');
      if (refundAmount > 0 && to === 'wallet') {
        const cust = row.customer_id ? await lockWallet(client, row.customer_id) : null;
        if (!cust || cust.user_id !== req.user.id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Dịch vụ chưa gắn khách hàng nên không hoàn vào ví được' });
        }
      }
      const refundAccountId = to === 'account' ? cr.accountId ?? null : null;
      await assertAccount(client, refundAccountId, req.user.id);

      // --- NCC hoàn: kiểm tra NCC + tài khoản trước khi ghi
      const supplierNames = new Map();
      for (const sr of b.supplierRefunds) {
        if (!(await assertOwns(client, 'suppliers', sr.supplierId, req.user.id))) throw new v.ValidationError('Nhà cung cấp không hợp lệ');
        await assertAccount(client, sr.accountId, req.user.id);
        if (!supplierNames.has(sr.supplierId)) {
          const n = await client.query('SELECT name FROM suppliers WHERE id = $1', [sr.supplierId]);
          supplierNames.set(sr.supplierId, n.rows[0].name);
        }
      }

      // 1. Trạng thái + giá bán = phí khách chịu
      await client.query(
        `UPDATE ${s.table}
            SET original_amount = COALESCE(original_amount, ${s.price}), ${s.price} = $2,
                status = 'cancelled', cancelled_at = $3, cancel_note = $4
          WHERE id = $1`,
        [id, b.finalAmount, b.cancelDate, b.note]
      );

      // 2. Hoàn tiền khách
      let refundPaymentId = null;
      if (refundAmount > 0) {
        const p = await client.query(
          `INSERT INTO payments (user_id, ${s.payCol}, amount, payment_date, method, notes, payment_target, account_id, kind)
           VALUES ($1, $2, $3, $4, $5, $6, 'self', $7, 'refund') RETURNING id`,
          [req.user.id, id, -refundAmount, b.cancelDate, to === 'wallet' ? 'wallet' : 'bank_transfer',
            b.note ? `Hoàn tiền huỷ: ${b.note}` : 'Hoàn tiền huỷ', refundAccountId]
        );
        refundPaymentId = p.rows[0].id;
        if (to === 'wallet') {
          await client.query(
            `INSERT INTO wallet_entries (user_id, customer_id, kind, amount, entry_date, payment_id, notes)
             VALUES ($1, $2, 'credit', $3, $4, $5, $6)`,
            [req.user.id, row.customer_id, refundAmount, b.cancelDate, refundPaymentId, `Hoàn huỷ ${row.label || s.name}`]
          );
        }
        await recomputeServicePaid(client, type, id);
      }

      // 3. Giá vốn: giữ giá trị cũ + dòng NCC hoàn
      if (b.supplierRefunds.length > 0) {
        await ensureBaseCostItem(client, req.user.id, type, row);
        let pos = await nextPosition(client, type, id);
        for (const sr of b.supplierRefunds) {
          const it = await client.query(
            `INSERT INTO cost_items (user_id, ${s.payCol}, supplier_id, label, amount, position, kind)
             VALUES ($1, $2, $3, $4, $5, $6, 'refund') RETURNING id`,
            [req.user.id, id, sr.supplierId, `Hoàn từ ${supplierNames.get(sr.supplierId)}`.slice(0, 100), -sr.amount, pos]
          );
          pos += 1;
          if (sr.receivedNow) {
            await client.query(
              `INSERT INTO supplier_payments (user_id, supplier_id, cost_item_id, account_id, amount, pay_date, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [req.user.id, sr.supplierId, it.rows[0].id, sr.accountId, -sr.amount, b.cancelDate, `Hoàn huỷ ${row.label || s.name}`]
            );
            await recomputeCostItemPaid(client, it.rows[0].id);
          }
        }
        await syncCostAmount(client, type, id);
      }

      const out = await loadServiceRow(client, type, id);
      await client.query('COMMIT');
      logAudit(req, {
        action: 'update', entity: s.entity, entityId: id,
        summary: `Huỷ ${row.label || s.name} của ${row.customer_name}: khách chịu ${fmtVnd(b.finalAmount)}, hoàn khách ${fmtVnd(refundAmount)}${refundAmount > 0 ? (to === 'wallet' ? ' vào ví' : ' qua TK') : ''}${b.supplierRefunds.length ? `, NCC hoàn ${fmtVnd(b.supplierRefunds.reduce((x, r) => x + r.amount, 0))}` : ''}`,
        details: { action: 'cancel', finalAmount: b.finalAmount, originalAmount: row.original_amount ?? row.total, refundAmount, refundTo: refundAmount > 0 ? to : null, refundPaymentId, supplierRefunds: b.supplierRefunds },
      });
      res.json(out);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
      logger.error(`Cancel ${type} error:`, error.message);
      res.status(500).json({ error: 'Failed to cancel' });
    } finally {
      client.release();
    }
  };
}

/** POST /api/{…}/:id/uncancel — hoàn tác TOÀN BỘ bước huỷ. */
function makeUncancelHandler(type) {
  const s = service(type);
  return async (req, res) => {
    const id = v.idParam(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await lockService(client, type, id, req.user.id);
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
      }
      if (!row.is_cancelled) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Dịch vụ chưa huỷ' });
      }

      // Tiền hoàn vào ví: xoá sẽ trừ lại ví → chặn nếu khách đã tiêu (ví sẽ âm).
      const credits = await client.query(
        `SELECT w.customer_id, SUM(w.amount) AS amount
           FROM wallet_entries w JOIN payments p ON p.id = w.payment_id
          WHERE p.${s.payCol} = $1 AND p.kind = 'refund' AND w.amount > 0
          GROUP BY w.customer_id ORDER BY w.customer_id`,
        [id]
      );
      for (const c of credits.rows) {
        await lockWallet(client, c.customer_id);
        const balance = await walletBalance(client, c.customer_id);
        if (Number(balance) - Number(c.amount) < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Khách đã dùng tiền hoàn trong ví (ví còn ${fmtVnd(balance)}) — không hoàn tác được` });
        }
      }

      const refunds = await client.query(`DELETE FROM payments WHERE ${s.payCol} = $1 AND kind = 'refund' RETURNING amount`, [id]);
      await recomputeServicePaid(client, type, id);

      const items = await client.query(`SELECT id FROM cost_items WHERE ${s.payCol} = $1 AND kind = 'refund'`, [id]);
      const itemIds = items.rows.map((r) => r.id);
      let spDeleted = 0;
      if (itemIds.length > 0) {
        const sp = await client.query('DELETE FROM supplier_payments WHERE cost_item_id = ANY($1::int[])', [itemIds]);
        spDeleted = sp.rowCount;
        await client.query('DELETE FROM cost_items WHERE id = ANY($1::int[])', [itemIds]);
        const left = await client.query(`SELECT 1 FROM cost_items WHERE ${s.payCol} = $1 LIMIT 1`, [id]);
        if (left.rows.length > 0) {
          await syncCostAmount(client, type, id);
        } else {
          // Trước khi huỷ không có dòng nào và cost_amount = 0 (cost_amount > 0 đã được giữ thành dòng "Giá vốn").
          await client.query(`UPDATE ${s.table} SET cost_amount = 0 WHERE id = $1`, [id]);
        }
      }

      await client.query(
        `UPDATE ${s.table}
            SET ${s.price} = COALESCE(original_amount, ${s.price}), original_amount = NULL,
                status = $2, cancelled_at = NULL, cancel_note = NULL
          WHERE id = $1`,
        [id, s.activeStatus]
      );

      const out = await loadServiceRow(client, type, id);
      await client.query('COMMIT');
      logAudit(req, {
        action: 'update', entity: s.entity, entityId: id,
        summary: `Hoàn tác huỷ ${row.label || s.name} của ${row.customer_name}`,
        details: { action: 'uncancel', refundsDeleted: refunds.rowCount, supplierRefundItems: itemIds.length, supplierPaymentsDeleted: spDeleted },
      });
      res.json(out);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
      logger.error(`Uncancel ${type} error:`, error.message);
      res.status(500).json({ error: 'Failed to uncancel' });
    } finally {
      client.release();
    }
  };
}

const ddmmyyyy = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** POST /api/debts/:id/change — đổi vé máy bay. */
async function changeDebt(req, res) {
  const id = v.idParam(req.params.id);
  const b = req.body;
  const changeDate = v.dateStr(b.changeDate, { label: 'Ngày đổi' }) || todayLocal();
  const customerFee = round2(v.amount(b.customerFee, { label: 'Phí đổi thu khách' }) ?? 0);
  const supplierFee = round2(v.amount(b.supplierFee, { label: 'Phí đổi trả NCC' }) ?? 0);
  const supplierId = v.int(b.supplierId, { min: 1, label: 'Nhà cung cấp' });
  const newFlightDate = v.dateStr(b.newFlightDate, { label: 'Ngày bay mới' });
  const newRoute = v.str(b.newRoute, { max: 50, label: 'Hành trình mới' });
  const newTicketCode = v.str(b.newTicketCode, { max: 50, label: 'Mã vé mới' });
  const note = v.str(b.note, { label: 'Ghi chú' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await lockService(client, 'debt', id, req.user.id);
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy vé' });
    }
    if (row.is_cancelled) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vé đã huỷ, không đổi được' });
    }
    if (supplierId !== null && !(await assertOwns(client, 'suppliers', supplierId, req.user.id))) {
      throw new v.ValidationError('Nhà cung cấp không hợp lệ');
    }

    if (supplierFee > 0) {
      await ensureBaseCostItem(client, req.user.id, 'debt', row);
      const pos = await nextPosition(client, 'debt', id);
      await client.query(
        `INSERT INTO cost_items (user_id, debt_id, supplier_id, label, amount, position, kind)
         VALUES ($1, $2, $3, 'Phí đổi vé', $4, $5, 'change')`,
        [req.user.id, id, supplierId, supplierFee, pos]
      );
      await syncCostAmount(client, 'debt', id);
    }

    const parts = [];
    if (newTicketCode) parts.push(`mã ${row.ticket_code || '—'} → ${newTicketCode}`);
    if (newRoute) parts.push(`hành trình ${row.route || '—'} → ${newRoute}`);
    if (newFlightDate) parts.push(`ngày bay ${row.flight_date ? ddmmyyyy(row.flight_date) : '—'} → ${ddmmyyyy(newFlightDate)}`);
    if (customerFee > 0) parts.push(`phí khách ${fmtVnd(customerFee)}`);
    if (supplierFee > 0) parts.push(`phí NCC ${fmtVnd(supplierFee)}`);
    if (note) parts.push(note);
    const line = `[${ddmmyyyy(changeDate)}] Đổi vé: ${parts.join('; ') || 'không đổi thông tin'}`;

    await client.query(
      `UPDATE debts
          SET ticket_amount = ticket_amount + $2,
              flight_date = COALESCE($3, flight_date),
              route = COALESCE($4, route),
              ticket_code = COALESCE($5, ticket_code),
              notes = CASE WHEN COALESCE(notes, '') = '' THEN $6 ELSE notes || E'\\n' || $6 END
        WHERE id = $1`,
      [id, customerFee, newFlightDate, newRoute, newTicketCode, line]
    );
    const out = await loadServiceRow(client, 'debt', id);
    await client.query('COMMIT');
    logAudit(req, {
      action: 'update', entity: 'debt', entityId: id,
      summary: `Đổi vé ${row.ticket_code || ''} của ${row.customer_name}: phí khách ${fmtVnd(customerFee)}, phí NCC ${fmtVnd(supplierFee)}`.replace(/\s+/g, ' '),
      details: { action: 'change', changeDate, customerFee, supplierFee, supplierId, newFlightDate, newRoute, newTicketCode },
    });
    res.json(out);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof v.ValidationError) return res.status(400).json({ error: error.message });
    logger.error('Change debt error:', error.message);
    res.status(500).json({ error: 'Failed to change ticket' });
  } finally {
    client.release();
  }
}

module.exports = { makeCancelHandler, makeUncancelHandler, changeDebt, parseCancelBody };
