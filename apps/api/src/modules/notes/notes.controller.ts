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
  Note,
  NoteCreateRequest,
  NoteImage,
  NoteImageCreateRequest,
  NoteListQuery,
  NoteUpdateRequest,
  NotesResponse,
} from '@nexter/contracts';
import {
  noteCreateRequestSchema,
  noteImageCreateRequestSchema,
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

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Note> {
    return this.notes.get(auth.user.id, id);
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

  @Post(':id/images')
  addImage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(noteImageCreateRequestSchema)) body: NoteImageCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<NoteImage> {
    return this.notes.addImage(auth.user.id, id, body, {
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
    return this.notes.removeImage(auth.user.id, id, imageId, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
