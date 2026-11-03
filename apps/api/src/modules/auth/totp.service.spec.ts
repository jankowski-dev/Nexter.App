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

  it('verifies a current TOTP code', async () => {
    const secret = service.generateSecret();
    const code = generateSync({ secret });

    await expect(service.verify(code, secret)).resolves.toBe(true);
    await expect(service.verify('000000', secret)).resolves.toBe(false);
  });

  it('renders a QR data URL', async () => {
    const secret = service.generateSecret();
    const qr = await service.qrDataUrl(service.uri('owner@example.com', secret));

    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
  });
});
