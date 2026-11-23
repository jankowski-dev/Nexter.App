import { describe, expect, it } from 'vitest';
import { ClockBackwardsError, SimulationClock } from './clock';

describe('SimulationClock', () => {
  it('starts at the initial timestamp', () => {
    expect(new SimulationClock(1_000).now()).toBe(1_000);
  });

  it('advances forward and accepts the same timestamp', () => {
    const clock = new SimulationClock(1_000);
    clock.advanceTo(2_000);
    expect(clock.now()).toBe(2_000);
    clock.advanceTo(2_000);
    expect(clock.now()).toBe(2_000);
  });

  it('rejects backwards time', () => {
    const clock = new SimulationClock(1_000);
    clock.advanceTo(2_000);
    expect(() => clock.advanceTo(1_999)).toThrow(ClockBackwardsError);
  });

  it('rejects non-finite or non-integer timestamps', () => {
    expect(() => new SimulationClock(Number.NaN)).toThrow();
    expect(() => new SimulationClock(1.5)).toThrow();
    const clock = new SimulationClock(1_000);
    expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => clock.advanceTo(1_000.5)).toThrow();
  });
});
