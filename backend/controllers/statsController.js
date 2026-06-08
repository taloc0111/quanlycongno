// controllers/statsController.js — Số liệu tổng hợp cho Dashboard công nợ.
const pool = require('../config/database');
const logger = require('../config/logger');

const getStats = async (req, res) => {
  try {
    const { agencyId } = req.query;
    const ids = agencyId && req.scope.userIds.includes(Number(agencyId))
      ? [Number(agencyId)]
      : req.scope.userIds;

    // Tổng hợp nợ vé + hộ chiếu trong phạm vi.
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
         (SELECT COUNT(*) FROM debts WHERE user_id=ANY($1))                            AS debt_count,
         (SELECT COUNT(*) FROM passports WHERE user_id=ANY($1))                        AS passport_count,
         (SELECT COUNT(*) FROM customers WHERE user_id=ANY($1))                        AS customer_count`,
      [ids]
    );
    const t = totals.rows[0];
    const totalAmount = Number(t.ticket_total) + Number(t.passport_total) + Number(t.train_total);
    const totalPaid = Number(t.ticket_paid) + Number(t.passport_paid) + Number(t.train_paid);
    const outstanding = totalAmount - totalPaid;
    // Lợi nhuận = (giá bán − giá gốc) của vé máy bay + hộ chiếu + vé tàu.
    const totalProfit =
      (Number(t.ticket_total) - Number(t.ticket_cost)) +
      (Number(t.passport_total) - Number(t.passport_cost)) +
      (Number(t.train_total) - Number(t.train_cost));

    // Nợ quá hạn (due_date < hôm nay và còn nợ) — gộp vé máy bay + hộ chiếu + vé tàu.
    const overdue = await pool.query(
      `SELECT COALESCE(SUM(out),0) AS amount FROM (
         SELECT ticket_amount - paid AS out FROM debts
           WHERE user_id=ANY($1) AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND ticket_amount > paid
         UNION ALL
         SELECT total_amount - paid_amount FROM passports
           WHERE user_id=ANY($1) AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND total_amount > paid_amount
         UNION ALL
         SELECT ticket_amount - paid FROM train_tickets
           WHERE user_id=ANY($1) AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND ticket_amount > paid
       ) x`,
      [ids]
    );

    // Top 10 khách còn nợ nhiều nhất (gộp theo tên khách, cả 3 nguồn).
    const topDebtors = await pool.query(
      `SELECT customer_name, SUM(out) AS outstanding FROM (
         SELECT customer_name, ticket_amount - paid AS out FROM debts WHERE user_id=ANY($1) AND ticket_amount > paid
         UNION ALL
         SELECT customer_name, total_amount - paid_amount FROM passports WHERE user_id=ANY($1) AND total_amount > paid_amount
         UNION ALL
         SELECT customer_name, ticket_amount - paid FROM train_tickets WHERE user_id=ANY($1) AND ticket_amount > paid
       ) x
       GROUP BY customer_name
       ORDER BY outstanding DESC
       LIMIT 10`,
      [ids]
    );

    // Doanh số & lợi nhuận 6 tháng gần nhất — gộp cả 3 nguồn (debts/train theo issue_date, passport theo service_date).
    const monthly = await pool.query(
      `SELECT month, SUM(amount) AS amount, SUM(cost) AS cost,
              SUM(amount - cost) AS profit, SUM(paid) AS paid
       FROM (
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month, ticket_amount AS amount, cost_amount AS cost, paid AS paid
           FROM debts WHERE user_id=ANY($1) AND issue_date >= (CURRENT_DATE - INTERVAL '6 months')
         UNION ALL
         SELECT to_char(date_trunc('month', service_date), 'YYYY-MM'), total_amount, cost_amount, paid_amount
           FROM passports WHERE user_id=ANY($1) AND service_date >= (CURRENT_DATE - INTERVAL '6 months')
         UNION ALL
         SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM'), ticket_amount, cost_amount, paid
           FROM train_tickets WHERE user_id=ANY($1) AND issue_date >= (CURRENT_DATE - INTERVAL '6 months')
       ) x
       WHERE month IS NOT NULL
       GROUP BY month ORDER BY month`,
      [ids]
    );

    res.json({
      totalAmount,
      totalPaid,
      outstanding,
      totalProfit,
      overdue: Number(overdue.rows[0].amount),
      counts: {
        debts: Number(t.debt_count),
        passports: Number(t.passport_count),
        customers: Number(t.customer_count),
      },
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
    });
  } catch (error) {
    logger.error('Get stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { getStats };
