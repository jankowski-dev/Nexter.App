import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  Habit,
  HabitCreateRequest,
  HabitListQuery,
  HabitUpdateRequest,
  HabitsResponse,
} from '@nexter/contracts';
import {
  habitCreateRequestSchema,
  habitListQuerySchema,
  habitUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { HabitsService } from './habits.service';

function meta(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@ApiTags('habits')
@Controller('habits')
export class HabitsController {
  constructor(private readonly habits: HabitsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(habitListQuerySchema)) query: HabitListQuery,
  ): Promise<HabitsResponse> {
    return this.habits.list(auth.user.id, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(habitCreateRequestSchema)) body: HabitCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Habit> {
    return this.habits.create(auth.user.id, body, meta(request));
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(habitUpdateRequestSchema)) body: HabitUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Habit> {
    return this.habits.update(auth.user.id, id, body, meta(request));
  }
}
