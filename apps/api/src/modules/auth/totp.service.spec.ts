import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';
import { TotpService } from './totp.service';

const service = new TotpService();

describe('TotpService', () => {
  it('generates a secret and otpauth URI', () => {
    const secret = service.generateSecret();
    const uri = service.uri('owner@example.com', secret);

    expect(secret.length).toBeGreaterThan(10);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=');
  });

  it('verifies a current TOTP code and returns its time step', async () => {
    const secret = service.generateSecret();
    const code = generateSync({ secret });
    const result = await service.verify(code, secret);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Number.isInteger(result.step)).toBe(true);
      expect(result.step).toBeGreaterThan(0);
    }

    await expect(service.verify('000000', secret)).resolves.toEqual({ valid: false });
  });

  it('returns a stable time step for the same code', async () => {
    const secret = service.generateSecret();
    const code = generateSync({ secret });
    const first = await service.verify(code, secret);
    const second = await service.verify(code, secret);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    if (first.valid && second.valid) {
      expect(second.step).toBe(first.step);
    }
  });

  it('renders a QR data URL', async () => {
    const secret = service.generateSecret();
    const qr = await service.qrDataUrl(service.uri('owner@example.com', secret));

    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
  });
});
