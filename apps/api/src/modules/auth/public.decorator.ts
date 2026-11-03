import { SetMetadata } from '@nestjs/common';
import { ALLOW_PENDING_2FA_KEY, IS_PUBLIC_KEY, SKIP_CSRF_KEY } from './auth.constants';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const AllowPending2fa = () => SetMetadata(ALLOW_PENDING_2FA_KEY, true);
