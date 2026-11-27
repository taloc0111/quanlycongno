// utils/costItems.js — dòng giá vốn (cost_items) gắn với 1 trong 4 dịch vụ
// (vé máy bay / hộ chiếu / vé tàu / tour). Xem docs/MONEY-FLOWS.md.
//
// Quy tắc:
//   - Body có khoá `costItems` (kể cả mảng rỗng) → THAY THẾ tập dòng trong cùng transaction:
//     có id = cập nhật, không id = thêm, dòng cũ không còn trong mảng = xoá
//     (supplier_payments gắn với dòng đó GIỮ NGUYÊN, cost_item_id → NULL qua FK).
//   - Còn ≥1 dòng → cost_amount = SUM(amount); không còn dòng → giữ costAmount gửi lên.
//   - Không gửi khoá `costItems` → không đụng dòng nào (tương thích FE/import cũ).
const v = require('./validate');
const { assertOwns } = require('./ownership');
const { todayLocal } = require('./dates');
const { logAudit } = require('./audit');
const { fmtVnd } = require('./money');

// targetType → bảng dịch vụ + cột khoá ngoại trên cost_items (whitelist, ghép thẳng vào SQL).
const TARGETS = {
  debt: { table: 'debts', col: 'debt_id', entity: 'debt' },
  passport: { table: 'passports', col: 'passport_id', entity: 'passport' },
  train: { table: 'train_tickets', col: 'train_ticket_id', entity: 'train_ticket' },
  tour: { table: 'tours', col: 'tour_id', entity: 'tour' },
};

const MAX_ITEMS = 50;

function target(targetType) {
  const t = TARGETS[targetType];
  if (!t) throw new Error(`costItems: loại dịch vụ không hợp lệ: ${targetType}`);
  return t;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

/**
 * Đọc + kiểm tra `body.costItems`. Ném ValidationError (→ 400) khi sai.
 * @returns {null|Array<{id:number|null, supplierId:number|null, label:string, amount:number, dueDate:string|null, payNow:null|{accountId:number|null, payDate:string|null}}>}
 *   null = body không có khoá costItems (không đụng dòng hiện có).
 */
function parseCostItems(body) {
  if (!has(body, 'costItems') || body.costItems === null || body.costItems === undefined) return null;
  const raw = body.costItems;
  if (!Array.isArray(raw)) throw new v.ValidationError('Danh sách giá vốn không hợp lệ');
  if (raw.length > MAX_ITEMS) throw new v.ValidationError(`Tối đa ${MAX_ITEMS} dòng giá vốn`);
  const seen = new Set();
  return raw.map((it, i) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      throw new v.ValidationError(`Dòng giá vốn ${i + 1} không hợp lệ`);
    }
    const p = `Dòng giá vốn ${i + 1}`;
    const id = v.int(it.id, { min: 1, label: `${p}: mã dòng` });
    if (id !== null) {
      if (seen.has(id)) throw new v.ValidationError(`${p}: trùng mã dòng`);
      seen.add(id);
    }
    const supplierId = v.int(it.supplierId, { min: 1, label: `${p}: nhà cung cấp` });
    const label = v.str(it.label, { max: 100, required: true, label: `${p}: tên khoản` });
    // Dòng cũ (có id) được phép mang số âm: FE gửi lại nguyên dòng "Hoàn từ NCC" (kind refund) khi sửa
    // dịch vụ đã huỷ — saveCostItems bỏ qua dòng đó và chặn số âm ở dòng thường.
    const amount = id !== null
      ? v.num(it.amount, { required: true, label: `${p}: số tiền` })
      : v.amount(it.amount, { required: true, label: `${p}: số tiền` });
    const dueDate = v.dateStr(it.dueDate, { label: `${p}: hạn trả` });
    let payNow = null;
    if (it.payNow === true) payNow = {};
    else if (it.payNow && typeof it.payNow === 'object' && !Array.isArray(it.payNow)) payNow = it.payNow;
    else if (it.payNow !== undefined && it.payNow !== null && it.payNow !== false) {
      throw new v.ValidationError(`${p}: trả ngay không hợp lệ`);
    }
    if (payNow) {
      payNow = {
        accountId: v.int(payNow.accountId, { min: 1, label: `${p}: tài khoản trả` }),
        payDate: v.dateStr(payNow.payDate, { label: `${p}: ngày trả` }),
      };
      if (supplierId === null) throw new v.ValidationError(`${p}: cần chọn nhà cung cấp để trả ngay`);
    }
    return { id, supplierId, label, amount, dueDate, payNow };
  });
}

/**
 * Các field "Dòng tiền v3" chung cho body tạo/sửa của 4 dịch vụ.
 * costPending: null = không gửi (sửa: giữ nguyên; tạo: FALSE).
 */
function parseMoneyFields(body) {
  return {
    costPending: v.bool(body.costPending, { label: 'Chưa đủ giá vốn' }),
    costItems: parseCostItems(body),
    accountId: v.int(body.accountId, { min: 1, label: 'Tài khoản' }),
    costAmountSent: has(body, 'costAmount'),
  };
}

/** Kiểm tra tài khoản tiền thuộc về user; sai → ValidationError "Tài khoản không hợp lệ". */
async function assertAccount(client, accountId, userId) {
  if (accountId === null || accountId === undefined) return;
  if (!(await assertOwns(client, 'money_accounts', accountId, userId))) {
    throw new v.ValidationError('Tài khoản không hợp lệ');
  }
}

/** paid_amount của 1 dòng giá vốn = tổng supplier_payments gắn với dòng đó. */
async function recomputeCostItemPaid(client, costItemId) {
  if (!costItemId) return;
  await client.query(
    `UPDATE cost_items SET paid_amount = COALESCE(
       (SELECT SUM(amount) FROM supplier_payments WHERE cost_item_id = $1), 0)
     WHERE id = $1`,
    [costItemId]
  );
}

/**
 * Thay thế tập dòng giá vốn của 1 dịch vụ (gọi TRONG transaction, dịch vụ đã được
 * xác nhận thuộc userId). Ném ValidationError khi id/NCC/tài khoản không hợp lệ.
 * @returns {Promise<{count:number, total:number, created:number, updated:number, deleted:number, paidNow:number}>}
 */
async function saveCostItems(client, userId, targetType, targetId, items) {
  const t = target(targetType);
  const existing = await client.query(
    `SELECT id, supplier_id, kind FROM cost_items WHERE ${t.col} = $1 AND user_id = $2 FOR UPDATE`,
    [targetId, userId]
  );
  const byId = new Map(existing.rows.map((r) => [r.id, r]));

  // 1) Kiểm tra mọi id ngoại trước khi ghi.
  for (const it of items) {
    if (it.id !== null && !byId.has(it.id)) throw new v.ValidationError('Dòng giá vốn không hợp lệ');
  }
  // Dòng "NCC hoàn" (kind refund) do Huỷ/hoàn tạo — chỉ Hoàn tác huỷ mới gỡ: bỏ qua nếu FE gửi lại,
  // và không xoá dù FE không gửi (giữ khớp với supplier_payments âm đã nhận).
  items = items.filter((it) => it.id === null || byId.get(it.id).kind !== 'refund');
  for (const it of items) {
    if (it.amount < 0) throw new v.ValidationError(`Dòng giá vốn "${it.label}": số tiền phải ≥ 0`);
  }
  const supplierIds = [...new Set(items.map((it) => it.supplierId).filter((x) => x !== null))];
  for (const sid of supplierIds) {
    if (!(await assertOwns(client, 'suppliers', sid, userId))) throw new v.ValidationError('Nhà cung cấp không hợp lệ');
  }
  const accountIds = [...new Set(items.map((it) => it.payNow?.accountId).filter((x) => x !== null && x !== undefined))];
  for (const aid of accountIds) await assertAccount(client, aid, userId);

  // 2) Xoá dòng không còn trong mảng (supplier_payments giữ lại, cost_item_id → NULL qua FK).
  const keep = items.filter((it) => it.id !== null).map((it) => it.id);
  const del = await client.query(
    `DELETE FROM cost_items WHERE ${t.col} = $1 AND user_id = $2 AND kind <> 'refund' AND NOT (id = ANY($3::int[])) RETURNING id`,
    [targetId, userId, keep]
  );

  // 3) Cập nhật / thêm theo đúng thứ tự gửi lên (position).
  let created = 0;
  let updated = 0;
  let paidNow = 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    total += it.amount;
    let itemId = it.id;
    if (itemId !== null) {
      const old = byId.get(itemId);
      // Đổi NCC: tiền đã trả cho NCC cũ tách khỏi dòng (thành trả gộp của NCC cũ) để số dư từng NCC đúng.
      if (old.supplier_id !== it.supplierId) {
        await client.query('UPDATE supplier_payments SET cost_item_id = NULL WHERE cost_item_id = $1', [itemId]);
      }
      await client.query(
        `UPDATE cost_items SET supplier_id = $2, label = $3, amount = $4, due_date = $5, position = $6
         WHERE id = $1`,
        [itemId, it.supplierId, it.label, it.amount, it.dueDate, i]
      );
      await recomputeCostItemPaid(client, itemId);
      updated += 1;
    } else {
      const ins = await client.query(
        `INSERT INTO cost_items (user_id, ${t.col}, supplier_id, label, amount, due_date, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [userId, targetId, it.supplierId, it.label, it.amount, it.dueDate, i]
      );
      itemId = ins.rows[0].id;
      created += 1;
    }

    // Trả ngay: tạo supplier_payment = phần còn nợ của dòng (đã trả đủ thì bỏ qua).
    if (it.payNow) {
      const rem = await client.query('SELECT amount - paid_amount AS remaining FROM cost_items WHERE id = $1', [itemId]);
      if (Number(rem.rows[0].remaining) > 0) {
        await client.query(
          `INSERT INTO supplier_payments (user_id, supplier_id, cost_item_id, account_id, amount, pay_date)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, it.supplierId, itemId, it.payNow.accountId, rem.rows[0].remaining, it.payNow.payDate || todayLocal()]
        );
        await recomputeCostItemPaid(client, itemId);
        paidNow += 1;
      }
    }
  }
  return { count: items.length, total, created, updated, deleted: del.rowCount, paidNow };
}

/**
 * Nếu dịch vụ có ≥1 dòng giá vốn → cost_amount = SUM(amount). Không có dòng nào thì
 * KHÔNG đụng cost_amount (giữ giá trị nhập tay / dữ liệu cũ).
 */
async function syncCostAmount(client, targetType, targetId) {
  const t = target(targetType);
  await client.query(
    `UPDATE ${t.table} SET cost_amount = s.total
       FROM (SELECT SUM(amount) AS total FROM cost_items WHERE ${t.col} = $1) s
      WHERE ${t.table}.id = $1 AND s.total IS NOT NULL`,
    [targetId]
  );
}

/**
 * Cột thêm cho GET danh sách: `cost_items` (JSON, sắp theo position) + `cost_unpaid`
 * (tổng còn nợ NCC của các dòng có NCC). `alias` = alias bảng dịch vụ trong câu SELECT.
 */
function costItemsSelectSql(targetType, alias) {
  const t = target(targetType);
  return `
    COALESCE((
      SELECT json_agg(json_build_object(
               'id', ci.id, 'supplier_id', ci.supplier_id, 'supplier_name', s.name, 'label', ci.label,
               'amount', ci.amount::text, 'paid_amount', ci.paid_amount::text, 'due_date', ci.due_date,
               'kind', ci.kind
             ) ORDER BY ci.position, ci.id)
        FROM cost_items ci LEFT JOIN suppliers s ON s.id = ci.supplier_id
       WHERE ci.${t.col} = ${alias}.id
    ), '[]'::json) AS cost_items,
    COALESCE((
      SELECT SUM(GREATEST(ci.amount - ci.paid_amount, 0))
        FROM cost_items ci
       WHERE ci.${t.col} = ${alias}.id AND ci.supplier_id IS NOT NULL
    ), 0) AS cost_unpaid`;
}

/** Đọc lại 1 dòng dịch vụ kèm cost_items + cost_unpaid (trả về cho POST/PUT). */
async function loadServiceRow(client, targetType, id) {
  const t = target(targetType);
  const r = await client.query(
    `SELECT x.*, ${costItemsSelectSql(targetType, 'x')} FROM ${t.table} x WHERE x.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

/**
 * Bước chung sau khi INSERT/UPDATE dịch vụ: lưu dòng giá vốn (nếu body có khoá costItems)
 * rồi đồng bộ cost_amount. Trả summary (hoặc null nếu không gửi costItems).
 */
async function applyCostItems(client, userId, targetType, targetId, items) {
  const summary = items ? await saveCostItems(client, userId, targetType, targetId, items) : null;
  await syncCostAmount(client, targetType, targetId);
  return summary;
}

/** 1 dòng audit tóm tắt thay đổi giá vốn cho mỗi lần lưu dịch vụ. */
function auditCostItems(req, targetType, targetId, summary) {
  if (!summary) return;
  logAudit(req, {
    action: 'update',
    entity: 'cost_items',
    entityId: targetId,
    summary: `Giá vốn ${targetType} #${targetId}: ${summary.count} dòng, tổng ${fmtVnd(summary.total)}`,
    details: { targetType, ...summary },
  });
}

module.exports = {
  TARGETS,
  parseCostItems,
  parseMoneyFields,
  assertAccount,
  recomputeCostItemPaid,
  saveCostItems,
  syncCostAmount,
  costItemsSelectSql,
  loadServiceRow,
  applyCostItems,
  auditCostItems,
};
