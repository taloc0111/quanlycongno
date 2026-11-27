// controllers/statsController.js — Số liệu tổng hợp cho Dashboard công nợ.
// Mốc "hôm nay" tính theo giờ VN (utils/dates) và truyền vào SQL — không dùng
// CURRENT_DATE vì server chạy UTC.
const pool = require('../config/database');
const logger = require('../config/logger');
const { todayLocal, addDays } = require('../utils/dates');

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
         (SELECT COUNT(*) FROM customers WHERE user_id=ANY($1))                        AS customer_count`,
      [ids]
    );
    const t = totals.rows[0];
    const n = (x) => Number(x) || 0;
    const byType = {
      debts: { amount: n(t.ticket_total), cost: n(t.ticket_cost), paid: n(t.ticket_paid), count: n(t.debt_count) },
      passports: { amount: n(t.passport_total), cost: n(t.passport_cost), paid: n(t.passport_paid), count: n(t.passport_count) },
      trainTickets: { amount: n(t.train_total), cost: n(t.train_cost), paid: n(t.train_paid), count: n(t.train_count) },
      tours: { amount: n(t.tour_total), cost: n(t.tour_cost), paid: n(t.tour_paid), count: n(t.tour_count) },
    };
    const totalAmount = byType.debts.amount + byType.passports.amount + byType.trainTickets.amount + byType.tours.amount;
    const totalPaid = byType.debts.paid + byType.passports.paid + byType.trainTickets.paid + byType.tours.paid;
    const outstanding = totalAmount - totalPaid;
    // Lợi nhuận = (giá bán − giá gốc) của vé máy bay + hộ chiếu + vé tàu + tour.
    const totalProfit =
      (byType.debts.amount - byType.debts.cost) +
      (byType.passports.amount - byType.passports.cost) +
      (byType.trainTickets.amount - byType.trainTickets.cost) +
      (byType.tours.amount - byType.tours.cost);

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
              SUM(amount - cost) AS profit, SUM(paid) AS paid
       FROM (
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month, ticket_amount AS amount, cost_amount AS cost, paid AS paid
           FROM debts WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', service_date), 'YYYY-MM'), total_amount, cost_amount, paid_amount
           FROM passports WHERE user_id=ANY($1) AND service_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM'), ticket_amount, cost_amount, paid
           FROM train_tickets WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
         UNION ALL
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM'), sell_amount, cost_amount, paid
           FROM tours WHERE user_id=ANY($1) AND issue_date >= ($2::date - INTERVAL '11 months')
       ) x
       WHERE month IS NOT NULL
       GROUP BY month ORDER BY month`,
      [ids, monthStart]
    );

    // Việc cần làm hôm nay.
    const [flightsTomorrow, dueSoon, overdueList, fareHits] = await Promise.all([
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
    ]);

    res.json({
      totalAmount,
      totalPaid,
      outstanding,
      totalProfit,
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
      },
    });
  } catch (error) {
    logger.error('Get stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { getStats };
