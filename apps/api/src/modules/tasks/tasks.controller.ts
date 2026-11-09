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
  Task,
  TaskCreateRequest,
  TaskListQuery,
  TaskUpdateRequest,
  TasksResponse,
} from '@nexter/contracts';
import {
  taskCreateRequestSchema,
  taskListQuerySchema,
  taskUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: TaskListQuery,
  ): Promise<TasksResponse> {
    return this.tasks.list(auth.user.id, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(taskCreateRequestSchema)) body: TaskCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Task> {
    return this.tasks.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(taskUpdateRequestSchema)) body: TaskUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Task> {
    return this.tasks.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
