// setup-admin.js
const bcrypt = require('bcryptjs');
const pool = require('./config/database');
require('dotenv').config();

const setupUsers = async () => {
  try {
    console.log('🔧 Setting up demo users...');

    const users = [
      { username: 'admin', password: 'admin123', role: 'admin', fullName: 'Quản trị viên' },
      { username: 'thuyduong', password: 'thuyduong2024', role: 'agency', fullName: 'Đại lý Thùy Dương (cấp 1)' },
      { username: 'user', password: '123456', role: 'user', fullName: 'Nhân viên' },
    ];

    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const result = await pool.query(
        `INSERT INTO users (username, password_hash, email, role, full_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING RETURNING id`,
        [user.username, hashedPassword, `${user.username}@example.com`, user.role, user.fullName]
      );

      // Đảm bảo role/full_name đúng kể cả khi user đã tồn tại từ trước.
      await pool.query('UPDATE users SET role = $2, full_name = COALESCE(full_name, $3) WHERE username = $1',
        [user.username, user.role, user.fullName]);

      console.log(result.rows.length > 0 ? `✅ Created user: ${user.username}` : `ℹ️ Updated user: ${user.username}`);
    }

    // Tạo 1 đại lý cấp 2 demo thuộc thuyduong (cấp 1).
    const parent = await pool.query('SELECT id FROM users WHERE username = $1', ['thuyduong']);
    const parentId = parent.rows[0].id;
    const childHash = await bcrypt.hash('daily2_2024', 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, email, role, full_name, parent_id)
       VALUES ($1, $2, $3, 'user', $4, $5)
       ON CONFLICT (username) DO UPDATE SET parent_id = EXCLUDED.parent_id`,
      ['daily2', childHash, 'daily2@example.com', 'Đại lý cấp 2 (demo)', parentId]
    );
    console.log('✅ Đại lý cấp 2 demo: daily2 / daily2_2024 (thuộc thuyduong)');

    // Add default routes for admin user
    const adminResult = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    const adminId = adminResult.rows[0].id;

    const defaultRoutes = [
      'HAN-SGN', 'SGN-HAN', 'HAN-DAD', 'DAD-HAN', 'SGN-DAD', 'DAD-SGN',
      'HAN-CXR', 'CXR-HAN', 'SGN-CXR', 'CXR-SGN', 'HAN-PQC', 'PQC-HAN',
      'SGN-PQC', 'PQC-SGN', 'HAN-VDO', 'VDO-HAN', 'HAN-BMV', 'BMV-HAN',
      'SGN-DLI', 'DLI-SGN', 'HAN-HPH', 'HPH-HAN', 'HAN-UIH', 'UIH-HAN'
    ];

    for (const route of defaultRoutes) {
      await pool.query(
        'INSERT INTO flight_routes (user_id, route_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [adminId, route]
      );
    }

    console.log(`✅ Added ${defaultRoutes.length} default routes for admin`);
    console.log('✅ Setup completed!');
    console.log('');
    console.log('Demo accounts created:');
    console.log('  Username: admin, Password: admin123');
    console.log('  Username: thuyduong, Password: thuyduong2024');
    console.log('  Username: user, Password: 123456');

    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
};

setupUsers();