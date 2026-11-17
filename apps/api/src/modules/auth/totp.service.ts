import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../shared/config/env';

export type TotpVerification = { valid: false } | { valid: true; step: number };

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

  async verify(
    code: string,
    secret: string,
    afterTimeStep?: number | null,
  ): Promise<TotpVerification> {
    try {
      const result = await verify({
        secret,
        token: code,
        epochTolerance: 30,
        ...(typeof afterTimeStep === 'number' ? { afterTimeStep } : {}),
      });

      if (!result.valid) return { valid: false };
      if (!('timeStep' in result)) return { valid: false };

      return {
        valid: true,
        step: result.timeStep,
      };
    } catch {
      return { valid: false };
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
