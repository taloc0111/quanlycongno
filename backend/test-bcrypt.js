const bcrypt = require('bcrypt');

async function testPassword() {
  const password = 'admin123';
  const hash = '$2b$10$rKvVzXEr3jTc8YjW0n2dqOpQJJxPvP.fCd5zj6KYx0KWGaQh7dHkW';
  
  const isMatch = await bcrypt.compare(password, hash);
  console.log('Password match:', isMatch);
  
  // Tạo hash mới
  const newHash = await bcrypt.hash(password, 10);
  console.log('New hash:', newHash);
}

testPassword();