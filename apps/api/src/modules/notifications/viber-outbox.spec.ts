import { describe, expect, it } from 'vitest';
import { nextViberFailure } from './viber-outbox.service';

describe('nextViberFailure', () => {
  it('keeps a failed delivery pending until the third attempt', () => {
    expect(nextViberFailure(0)).toEqual({ attempts: 1, status: 'pending' });
    expect(nextViberFailure(1)).toEqual({ attempts: 2, status: 'pending' });
    expect(nextViberFailure(2)).toEqual({ attempts: 3, status: 'failed' });
    expect(nextViberFailure(3)).toEqual({ attempts: 4, status: 'failed' });
  });
});
