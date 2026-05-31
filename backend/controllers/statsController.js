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
         (SELECT COALESCE(SUM(paid),0)          FROM debts WHERE user_id=ANY($1))      AS ticket_paid,
         (SELECT COALESCE(SUM(total_amount),0)  FROM passports WHERE user_id=ANY($1))  AS passport_total,
         (SELECT COALESCE(SUM(paid_amount),0)   FROM passports WHERE user_id=ANY($1))  AS passport_paid,
         (SELECT COUNT(*) FROM debts WHERE user_id=ANY($1))                            AS debt_count,
         (SELECT COUNT(*) FROM passports WHERE user_id=ANY($1))                        AS passport_count,
         (SELECT COUNT(*) FROM customers WHERE user_id=ANY($1))                        AS customer_count`,
      [ids]
    );
    const t = totals.rows[0];
    const totalAmount = Number(t.ticket_total) + Number(t.passport_total);
    const totalPaid = Number(t.ticket_paid) + Number(t.passport_paid);
    const outstanding = totalAmount - totalPaid;

    // Nợ quá hạn (due_date < hôm nay và còn nợ).
    const overdue = await pool.query(
      `SELECT COALESCE(SUM(ticket_amount - paid),0) AS amount
       FROM debts
       WHERE user_id=ANY($1) AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND ticket_amount > paid`,
      [ids]
    );

    // Top 10 khách còn nợ nhiều nhất (gộp theo tên khách).
    const topDebtors = await pool.query(
      `SELECT customer_name, SUM(ticket_amount - paid) AS outstanding
       FROM debts
       WHERE user_id=ANY($1) AND ticket_amount > paid
       GROUP BY customer_name
       ORDER BY outstanding DESC
       LIMIT 10`,
      [ids]
    );

    // Công nợ vé theo 6 tháng gần nhất (theo ngày xuất vé).
    const monthly = await pool.query(
      `SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
              SUM(ticket_amount) AS amount,
              SUM(paid) AS paid
       FROM debts
       WHERE user_id=ANY($1) AND issue_date >= (CURRENT_DATE - INTERVAL '6 months')
       GROUP BY 1 ORDER BY 1`,
      [ids]
    );

    res.json({
      totalAmount,
      totalPaid,
      outstanding,
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
        paid: Number(r.paid),
      })),
    });
  } catch (error) {
    logger.error('Get stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { getStats };
