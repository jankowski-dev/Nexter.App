import { describe, expect, it } from 'vitest';
import { bufferedGasLimit } from './gas-limit';

describe('bufferedGasLimit', () => {
  it('uses the largest estimate and adds a 20% buffer', () => {
    expect(bufferedGasLimit(['561609', '570404'])).toBe('684485');
    expect(bufferedGasLimit(['570404', '561609'])).toBe('684485');
  });

  it('ignores missing and invalid estimates', () => {
    expect(bufferedGasLimit([null, undefined, 'nope', '0'])).toBeNull();
    expect(bufferedGasLimit([null, '120000'])).toBe('150000');
  });

  it('applies a lower bound and a safe upper bound', () => {
    expect(bufferedGasLimit(['1'])).toBe('150000');
    expect(bufferedGasLimit(['100000000'])).toBe('10000000');
  });

  it('rounds the buffer up', () => {
    expect(bufferedGasLimit(['150001'])).toBe('180002');
  });
});
