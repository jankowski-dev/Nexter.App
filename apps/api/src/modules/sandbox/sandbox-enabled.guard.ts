import { Inject, Injectable, NotFoundException, type CanActivate } from '@nestjs/common';
import { SANDBOX_ENABLED } from './sandbox.types';

/**
 * Hides the sandbox data API when the feature flag is off. The status endpoint
 * stays reachable so the owner can see that the feature is disabled.
 */
@Injectable()
export class SandboxEnabledGuard implements CanActivate {
  constructor(@Inject(SANDBOX_ENABLED) private readonly enabled: boolean) {}

  canActivate(): boolean {
    if (!this.enabled) {
      throw new NotFoundException({
        code: 'SANDBOX_DISABLED',
        message: 'Sandbox is disabled',
      });
    }

    return true;
  }
}
