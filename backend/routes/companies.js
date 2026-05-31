// routes/companies.js
const express = require('express');
const { getCompanies, createCompany, updateCompany, deleteCompany } = require('../controllers/companyController');

const router = express.Router();

router.get('/', getCompanies);
router.post('/', createCompany);
router.put('/:id', updateCompany);
router.delete('/:id', deleteCompany);

module.exports = router;