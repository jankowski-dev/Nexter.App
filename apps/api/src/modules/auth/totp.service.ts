import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../shared/config/env';

@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  uri(email: string, secret: string): string {
    return generateURI({
      issuer: env.TOTP_ISSUER,
      label: email,
      secret,
    });
  }

  async verify(code: string, secret: string): Promise<boolean> {
    try {
      const result = await verify({
        secret,
        token: code,
        epochTolerance: 30,
      });

      return result.valid;
    } catch {
      return false;
    }
  }

  async qrDataUrl(uri: string): Promise<string> {
    return QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256,
    });
  }
}
