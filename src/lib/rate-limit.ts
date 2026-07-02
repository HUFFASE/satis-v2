// Simple in-memory rate limiter for brute-force protection.
// Note: In production / multi-instance environments, this should be moved to Redis or database-backed tracking.

interface LoginAttempt {
  count: number;
  blockedUntil: number;
}

const attempts = new Map<string, LoginAttempt>();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MINUTES = 15;

/**
 * Checks if a login key is currently allowed to try logging in.
 */
export function checkRateLimit(key: string): { allowed: boolean; remaining: number; blockedUntil?: Date } {
  const now = Date.now();
  const attempt = attempts.get(key);

  if (attempt) {
    // If currently blocked, check if block duration has expired
    if (attempt.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        blockedUntil: new Date(attempt.blockedUntil),
      };
    }

    // If block expired, reset
    if (attempt.blockedUntil > 0 && attempt.blockedUntil <= now) {
      attempts.delete(key);
    }
  }

  const currentAttempts = attempt ? attempt.count : 0;
  return {
    allowed: currentAttempts < MAX_ATTEMPTS,
    remaining: Math.max(0, MAX_ATTEMPTS - currentAttempts),
  };
}

/**
 * Registers a failed login attempt and returns the remaining attempts or block date.
 */
export function registerFailedAttempt(key: string): { remaining: number; blockedUntil?: Date } {
  const now = Date.now();
  let attempt = attempts.get(key);

  if (!attempt) {
    attempt = { count: 0, blockedUntil: 0 };
  }

  attempt.count += 1;

  if (attempt.count >= MAX_ATTEMPTS) {
    attempt.blockedUntil = now + BLOCK_DURATION_MINUTES * 60 * 1000;
  }

  attempts.set(key, attempt);

  return {
    remaining: Math.max(0, MAX_ATTEMPTS - attempt.count),
    blockedUntil: attempt.blockedUntil > 0 ? new Date(attempt.blockedUntil) : undefined,
  };
}

/**
 * Resets the login attempts for a key upon successful login.
 */
export function resetAttempts(key: string) {
  attempts.delete(key);
}
