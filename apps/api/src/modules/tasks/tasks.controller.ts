import {
  Body,
  Controller,
  Delete,
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
  TaskImage,
  TaskImageCreateRequest,
  TaskListQuery,
  TaskUpdateRequest,
  TasksResponse,
} from '@nexter/contracts';
import {
  taskCreateRequestSchema,
  taskImageCreateRequestSchema,
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

  @Post(':id/images')
  addImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(taskImageCreateRequestSchema)) body: TaskImageCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<TaskImage> {
    return this.tasks.addImage(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete(':id/images/:imageId')
  removeImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('imageId', new ParseUUIDPipe()) imageId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.tasks.removeImage(auth.user.id, id, imageId, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
