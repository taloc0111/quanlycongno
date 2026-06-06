// routes/users.js
const express = require('express');
const { getUsers, createUser, updateUser, setTrial, deleteUser } = require('../controllers/userController');

const router = express.Router();

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id/trial', setTrial);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
