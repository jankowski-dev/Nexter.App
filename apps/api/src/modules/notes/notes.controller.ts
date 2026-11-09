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
  Note,
  NoteCreateRequest,
  NoteListQuery,
  NoteUpdateRequest,
  NotesResponse,
} from '@nexter/contracts';
import {
  noteCreateRequestSchema,
  noteListQuerySchema,
  noteUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { NotesService } from './notes.service';

@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(noteListQuerySchema)) query: NoteListQuery,
  ): Promise<NotesResponse> {
    return this.notes.list(auth.user.id, query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(noteCreateRequestSchema)) body: NoteCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Note> {
    return this.notes.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(noteUpdateRequestSchema)) body: NoteUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<Note> {
    return this.notes.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
