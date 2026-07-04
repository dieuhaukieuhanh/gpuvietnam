export function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let password = 'Gpu';
  for (let i = 0; i < 14; i += 1) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${password}1`;
}
