import { describe, expect, it } from 'vitest';
import { createRecoveryCode, recoveryHash, validAccountPassword } from '@/lib/auth/usernameRegistration';
describe('username recovery credentials', () => {
  it('generates independent 192-bit recovery codes', () => {
    const a = createRecoveryCode();
    expect(a).toMatch(/^[a-f0-9]{8}(-[a-f0-9]{8}){5}$/);
    expect(createRecoveryCode()).not.toBe(a);
  });
  it('normalizes copy formatting without storing the raw code', async () => {
    const code = createRecoveryCode();
    const hash = await recoveryHash(code);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await recoveryHash(code.toUpperCase().replace(/-/g, ' '))).toBe(hash);
    expect(hash).not.toContain(code);
  });
  it('requires a minimal length and a bcrypt-safe maximum', () => {
    expect(validAccountPassword('1234')).toBe(false);
    expect(validAccountPassword('abc123')).toBe(true);
    expect(validAccountPassword('Torah12345')).toBe(true);
    expect(validAccountPassword('א'.repeat(40) + '1')).toBe(false);
  });
});
