import { describe, expect, it } from 'vitest';
import { router } from '@/app/router';

describe('sandbox route', () => {
  it('registers /sandbox inside the authenticated app layout', () => {
    const route = router.routesById['/app/sandbox'];
    expect(route).toBeDefined();
    expect(route?.fullPath).toBe('/sandbox');
    expect(route?.parentRoute?.id).toBe('/app');
  });
});
