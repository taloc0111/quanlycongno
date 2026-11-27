// routes/audit.js — nhật ký thao tác (chỉ xem).
const express = require('express');
const { getAuditLogs } = require('../controllers/auditController');

const router = express.Router();

router.get('/', getAuditLogs);

module.exports = router;
