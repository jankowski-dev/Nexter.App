import { SetMetadata } from '@nestjs/common';
import { ALLOW_PENDING_2FA_METADATA, IS_PUBLIC_METADATA, SKIP_CSRF_METADATA } from './auth.constants';

export const Public = () => SetMetadata(IS_PUBLIC_METADATA, true);

export const SkipCsrf = () => SetMetadata(SKIP_CSRF_METADATA, true);

export const AllowPending2fa = () => SetMetadata(ALLOW_PENDING_2FA_METADATA, true);
