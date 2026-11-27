// routes/users.js
const express = require('express');
const {
  getUsers, createUser, updateUser, setTrial, deleteUser, setFeatures, resetUserPassword,
} = require('../controllers/userController');

const router = express.Router();

router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id/trial', setTrial);
router.put('/:id/features', setFeatures);        // admin: bật/tắt tính năng (vd fareWatch)
router.post('/:id/password', resetUserPassword); // admin/đại lý cha: đặt lại mật khẩu
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
