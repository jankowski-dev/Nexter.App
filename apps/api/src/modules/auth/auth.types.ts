import type { Session, User } from '@nexter/db';
import type { FastifyRequest } from 'fastify';

export interface AuthContext {
  user: User;
  session: Session;
}

export interface RequestWithAuth extends FastifyRequest {
  auth?: AuthContext;
}
