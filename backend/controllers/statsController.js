// controllers/statsController.js — Số liệu tổng hợp cho Dashboard công nợ.
// Mốc "hôm nay" tính theo giờ VN (utils/dates) và truyền vào SQL — không dùng
// CURRENT_DATE vì server chạy UTC.
const pool = require('../config/database');
const logger = require('../config/logger');
const { todayLocal, addDays } = require('../utils/dates');
const { accountListSql, targetLabelSql, targetTypeSql, targetJoinsSql } = require('../utils/money');

// Dòng tiền v3: dòng cost_pending ("Chưa đủ giá vốn") KHÔNG tính vào lợi nhuận ở mọi nơi,
// nhưng vẫn tính doanh số / đã thu / còn nợ.

const getStats = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;
    const today = todayLocal();
    const tomorrow = addDays(today, 1);
    const in7 = addDays(today, 7);

    // Tổng hợp theo từng loại dịch vụ trong phạm vi.
    const totals = await pool.query(
      `SELECT
         (SELECT COALESCE(SUM(ticket_amount),0) FROM debts WHERE user_id=ANY($1))      AS ticket_total,
         (SELECT COALESCE(SUM(cost_amount),0)   FROM debts WHERE user_id=ANY($1))      AS ticket_cost,
         (SELECT COALESCE(SUM(paid),0)          FROM debts WHERE user_id=ANY($1))      AS ticket_paid,
         (SELECT COALESCE(SUM(total_amount),0)  FROM passports WHERE user_id=ANY($1))  AS passport_total,
         (SELECT COALESCE(SUM(cost_amount),0)   FROM passports WHERE user_id=ANY($1))  AS passport_cost,
         (SELECT COALESCE(SUM(paid_amount),0)   FROM passports WHERE user_id=ANY($1))  AS passport_paid,
         (SELECT COALESCE(SUM(ticket_amount),0) FROM train_tickets WHERE user_id=ANY($1)) AS train_total,
         (SELECT COALESCE(SUM(cost_amount),0)   FROM train_tickets WHERE user_id=ANY($1)) AS train_cost,
         (SELECT COALESCE(SUM(paid),0)          FROM train_tickets WHERE user_id=ANY($1)) AS train_paid,
         (SELECT COALESCE(SUM(sell_amount),0)   FROM tours WHERE user_id=ANY($1))         AS tour_total,
         (SELECT COALESCE(SUM(cost_amount),0)   FROM tours WHERE user_id=ANY($1))         AS tour_cost,
         (SELECT COALESCE(SUM(paid),0)          FROM tours WHERE user_id=ANY($1))         AS tour_paid,
         (SELECT COUNT(*) FROM debts WHERE user_id=ANY($1))                            AS debt_count,
         (SELECT COUNT(*) FROM passports WHERE user_id=ANY($1))                        AS passport_count,
         (SELECT COUNT(*) FROM train_tickets WHERE user_id=ANY($1))                    AS train_count,
         (SELECT COUNT(*) FROM tours WHERE user_id=ANY($1))                            AS tour_count,
         (SELECT COUNT(*) FROM customers WHERE user_id=ANY($1))                        AS customer_count,
         -- Lợi nhuận bỏ qua dòng cost_pending + số dòng đang chờ giá vốn.
         (SELECT COALESCE(SUM(ticket_amount - cost_amount) FILTER (WHERE NOT cost_pending),0) FROM debts WHERE user_id=ANY($1))         AS ticket_profit,
         (SELECT COALESCE(SUM(total_amount - cost_amount) FILTER (WHERE NOT cost_pending),0)  FROM passports WHERE user_id=ANY($1))     AS passport_profit,
         (SELECT COALESCE(SUM(ticket_amount - cost_amount) FILTER (WHERE NOT cost_pending),0) FROM train_tickets WHERE user_id=ANY($1)) AS train_profit,
         (SELECT COALESCE(SUM(sell_amount - cost_amount) FILTER (WHERE NOT cost_pending),0)   FROM tours WHERE user_id=ANY($1))         AS tour_profit,
         (SELECT COUNT(*) FROM debts WHERE user_id=ANY($1) AND cost_pending)         AS ticket_pending,
         (SELECT COUNT(*) FROM passports WHERE user_id=ANY($1) AND cost_pending)     AS passport_pending,
         (SELECT COUNT(*) FROM train_tickets WHERE user_id=ANY($1) AND cost_pending) AS train_pending,
         (SELECT COUNT(*) FROM tours WHERE user_id=ANY($1) AND cost_pending)         AS tour_pending`,
      [ids]
    );
    const t = totals.rows[0];
    const n = (x) => Number(x) || 0;
    const byType = {
      debts: { amount: n(t.ticket_total), cost: n(t.ticket_cost), paid: n(t.ticket_paid), count: n(t.debt_count), profit: n(t.ticket_profit), costPendingCount: n(t.ticket_pending) },
      passports: { amount: n(t.passport_total), cost: n(t.passport_cost), paid: n(t.passport_paid), count: n(t.passport_count), profit: n(t.passport_profit), costPendingCount: n(t.passport_pending) },
      trainTickets: { amount: n(t.train_total), cost: n(t.train_cost), paid: n(t.train_paid), count: n(t.train_count), profit: n(t.train_profit), costPendingCount: n(t.train_pending) },
      tours: { amount: n(t.tour_total), cost: n(t.tour_cost), paid: n(t.tour_paid), count: n(t.tour_count), profit: n(t.tour_profit), costPendingCount: n(t.tour_pending) },
    };
    const totalAmount = byType.debts.amount + byType.passports.amount + byType.trainTickets.amount + byType.tours.amount;
    const totalPaid = byType.debts.paid + byType.passports.paid + byType.trainTickets.paid + byType.tours.paid;
    const outstanding = totalAmount - totalPaid;
    // Lợi nhuận = (giá bán − giá gốc) của vé máy bay + hộ chiếu + vé tàu + tour, BỎ QUA dòng "Chưa đủ giá vốn".
    const totalProfit = byType.debts.profit + byType.passports.profit + byType.trainTickets.profit + byType.tours.profit;
    const costPendingCount =
      byType.debts.costPendingCount + byType.passports.costPendingCount +
      byType.trainTickets.costPendingCount + byType.tours.costPendingCount;

    // Dòng tiền: nợ NCC (tổng balance các NCC), tổng số dư ví khách, tiền đang ở TK người khác giữ hộ.
    const money = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(ci.amount) FROM cost_items ci JOIN suppliers s ON s.id = ci.supplier_id WHERE s.user_id=ANY($1)), 0)
         - COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id WHERE s.user_id=ANY($1)), 0)
                                                                                         AS supplier_owed,
         (SELECT COALESCE(SUM(amount),0) FROM wallet_entries WHERE user_id=ANY($1))    AS wallet_total,
         (SELECT COALESCE(SUM(balance),0) FROM (${accountListSql('AND a.is_own = FALSE')}) acc) AS others_holding`,
      [ids]
    );
    const m = money.rows[0];

    // Các khoản còn nợ có hạn thanh toán — dùng chung cho overdue/dueSoon (4 nguồn).
    const DUE_UNION = `
      SELECT 'debt' AS type, id, customer_name, phone_number, due_date, ticket_amount - paid AS outstanding
        FROM debts WHERE user_id=ANY($1) AND due_date IS NOT NULL AND ticket_amount > paid
      UNION ALL
      SELECT 'passport', id, customer_name, phone_number, due_date, total_amount - paid_amount
        FROM passports WHERE user_id=ANY($1) AND due_date IS NOT NULL AND total_amount > paid_amount
      UNION ALL
      SELECT 'train', id, customer_name, phone_number, due_date, ticket_amount - paid
        FROM train_tickets WHERE user_id=ANY($1) AND due_date IS NOT NULL AND ticket_amount > paid
      UNION ALL
      SELECT 'tour', id, customer_name, phone_number, due_date, sell_amount - paid
        FROM tours WHERE user_id=ANY($1) AND due_date IS NOT NULL AND sell_amount > paid`;

    // Nợ quá hạn (due_date < hôm nay và còn nợ).
    const overdue = await pool.query(
      `SELECT COALESCE(SUM(outstanding),0) AS amount FROM (${DUE_UNION}) x WHERE due_date < $2::date`,
      [ids, today]
    );

    // Top 10 khách còn nợ nhiều nhất (gộp theo tên khách, cả 4 nguồn).
    const topDebtors = await pool.query(
      `SELECT customer_name, SUM(out) AS outstanding FROM (
         SELECT customer_name, ticket_amount - paid AS out FROM debts WHERE user_id=ANY($1) AND ticket_amount > paid
         UNION ALL
         SELECT customer_name, total_amount - paid_amount FROM passports WHERE user_id=ANY($1) AND total_amount > paid_amount
         UNION ALL
         SELECT customer_name, ticket_amount - paid FROM train_tickets WHERE user_id=ANY($1) AND ticket_amount > paid
         UNION ALL
         SELECT customer_name, sell_amount - paid FROM tours WHERE user_id=ANY($1) AND sell_amount > paid
       ) x
       GROUP BY customer_name
       ORDER BY outstanding DESC
       LIMIT 10`,
      [ids]
    );

    // Doanh số & lợi nhuận 12 tháng gần nhất — gộp 4 nguồn (debts/train/tour theo issue_date, passport theo service_date).
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthly = await pool.query(
      `SELECT month, SUM(amount) AS amount, SUM(cost) AS cost,
              SUM(CASE WHEN pending THEN 0 ELSE amount - cost END) AS profit, SUM(paid) AS paid
       FROM (
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month, ticket_amount AS amount, cost_amount AS cost, paid AS paid, cost_pending AS pending
           FROM debts WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', service_date), 'YYYY-MM'), total_amount, cost_amount, paid_amount, cost_pending
           FROM passports WHERE user_id=ANY($1) AND service_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM'), ticket_amount, cost_amount, paid, cost_pending
           FROM train_tickets WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM'), sell_amount, cost_amount, paid, cost_pending
           FROM tours WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
       ) x
       WHERE month IS NOT NULL
       GROUP BY month ORDER BY month`,
      [ids, monthStart]
    );

    // Việc cần làm hôm nay.
    const [flightsTomorrow, dueSoon, overdueList, fareHits, costPendingList, supplierDue] = await Promise.all([
      // Khách bay ngày mai (kể cả đã check-in — FE tự phân biệt bằng checked_in).
      pool.query(
        `SELECT id, customer_name, phone_number, flight_date, route, airline, ticket_code, checked_in
           FROM debts WHERE user_id=ANY($1) AND flight_date = $2::date
          ORDER BY checked_in ASC, customer_name`,
        [ids, tomorrow]
      ),
      // Sắp đến hạn trong 7 ngày tới (từ hôm nay).
      pool.query(
        `SELECT type, id, customer_name, phone_number, due_date, outstanding FROM (${DUE_UNION}) x
          WHERE due_date >= $2::date AND due_date <= $3::date
          ORDER BY due_date ASC, outstanding DESC LIMIT 100`,
        [ids, today, in7]
      ),
      // Quá hạn (giới hạn 50, quá hạn lâu nhất trước).
      pool.query(
        `SELECT type, id, customer_name, phone_number, due_date, outstanding FROM (${DUE_UNION}) x
          WHERE due_date < $2::date
          ORDER BY due_date ASC, outstanding DESC LIMIT 50`,
        [ids, today]
      ),
      // Canh vé đã đạt giá mong muốn.
      pool.query(
        `SELECT id, customer_name, route, depart_date, last_price, target_price
           FROM ticket_watches
          WHERE user_id=ANY($1) AND status = 'watching'
            AND last_price IS NOT NULL AND target_price > 0 AND last_price <= target_price
          ORDER BY depart_date ASC NULLS LAST, id`,
        [ids]
      ),
      // Dòng "Chưa đủ giá vốn" (mới nhất trước, tối đa 50).
      pool.query(
        `SELECT type, id, customer_name, issue_date, amount FROM (
           SELECT 'debt' AS type, id, customer_name, issue_date, ticket_amount AS amount, created_at
             FROM debts WHERE user_id=ANY($1) AND cost_pending
           UNION ALL
           SELECT 'passport', id, customer_name, service_date, total_amount, created_at
             FROM passports WHERE user_id=ANY($1) AND cost_pending
           UNION ALL
           SELECT 'train', id, customer_name, issue_date, ticket_amount, created_at
             FROM train_tickets WHERE user_id=ANY($1) AND cost_pending
           UNION ALL
           SELECT 'tour', id, customer_name, issue_date, sell_amount, created_at
             FROM tours WHERE user_id=ANY($1) AND cost_pending
         ) x
         ORDER BY issue_date DESC NULLS LAST, created_at DESC, id DESC
         LIMIT 50`,
        [ids]
      ),
      // Dòng giá vốn còn nợ NCC, hạn trả ≤ hôm nay + 7 (gồm cả quá hạn), tối đa 50.
      pool.query(
        `SELECT ci.id, ci.supplier_id, s.name AS supplier_name, ci.label,
                ci.amount - ci.paid_amount AS amount_due, ci.due_date,
                ${targetTypeSql('ci')} AS target_type,
                COALESCE(ci.debt_id, ci.passport_id, ci.train_ticket_id, ci.tour_id) AS target_id,
                COALESCE(d.customer_name, ps.customer_name, tr.customer_name, tu.customer_name) AS customer_name,
                ${targetLabelSql()} AS target_label
           FROM cost_items ci
           JOIN suppliers s ON s.id = ci.supplier_id
           ${targetJoinsSql('ci')}
          WHERE ci.user_id=ANY($1) AND ci.amount > ci.paid_amount
            AND ci.due_date IS NOT NULL AND ci.due_date <= $2::date
          ORDER BY ci.due_date ASC, ci.id
          LIMIT 50`,
        [ids, in7]
      ),
    ]);

    res.json({
      totalAmount,
      totalPaid,
      outstanding,
      totalProfit,
      costPendingCount,
      supplierOwed: n(m.supplier_owed),
      walletTotal: n(m.wallet_total),
      othersHolding: n(m.others_holding),
      overdue: Number(overdue.rows[0].amount),
      counts: {
        debts: byType.debts.count,
        passports: byType.passports.count,
        trainTickets: byType.trainTickets.count,
        tours: byType.tours.count,
        customers: n(t.customer_count),
      },
      byType,
      topDebtors: topDebtors.rows.map((r) => ({
        name: r.customer_name,
        outstanding: Number(r.outstanding),
      })),
      monthly: monthly.rows.map((r) => ({
        month: r.month,
        amount: Number(r.amount),
        cost: Number(r.cost),
        profit: Number(r.profit),
        paid: Number(r.paid),
      })),
      todo: {
        flightsTomorrow: flightsTomorrow.rows,
        dueSoon: dueSoon.rows.map((r) => ({ ...r, outstanding: Number(r.outstanding) })),
        overdue: overdueList.rows.map((r) => ({ ...r, outstanding: Number(r.outstanding) })),
        fareHits: fareHits.rows.map((r) => ({ ...r, last_price: Number(r.last_price), target_price: Number(r.target_price) })),
        costPending: costPendingList.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
        supplierDue: supplierDue.rows.map((r) => ({ ...r, amount_due: Number(r.amount_due) })),
      },
    });
  } catch (error) {
    logger.error('Get stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { getStats };
