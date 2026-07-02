import bcrypt from "bcryptjs";

/**
 * Hashes a plain text password using bcryptjs with a high-security salt round count (12).
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
}

/**
 * Verifies a plain text password against a stored bcrypt hash.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
