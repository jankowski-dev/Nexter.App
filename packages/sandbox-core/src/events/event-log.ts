import type { SandboxEvent, SandboxEventInput } from './event-types';

export interface EventLog {
  append(input: SandboxEventInput): Promise<SandboxEvent>;
  events(): readonly SandboxEvent[];
  hash(): string;
}
