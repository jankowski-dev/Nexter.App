import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ImportReconciliationResponse,
  ImportResponse,
  ImportsResponse,
  NotionImportRequest,
} from '@nexter/contracts';
import { notionImportRequestSchema } from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { NOTION_IMPORT_CONTENT_TYPE } from './import-body-parser';
import { NotionImportService } from './notion-import.service';

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: NotionImportService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<ImportsResponse> {
    return this.imports.list(auth.user.id);
  }

  @Get(':id/reconciliation')
  reconciliation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ImportReconciliationResponse> {
    return this.imports.reconciliation(auth.user.id, id);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ImportResponse> {
    return this.imports.get(auth.user.id, id);
  }

  @Post('notion/preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(notionImportRequestSchema)) body: NotionImportRequest,
    @Req() request: FastifyRequest,
  ): Promise<ImportResponse> {
    const mediaType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();

    if (mediaType !== NOTION_IMPORT_CONTENT_TYPE) {
      throw new UnsupportedMediaTypeException({
        code: 'VALIDATION_ERROR',
        message: 'Use application/x-notion-import+json for Notion import preview',
      });
    }

    return this.imports.preview(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post(':id/commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportResponse> {
    return this.imports.commit(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post(':id/rollback')
  @HttpCode(HttpStatus.OK)
  rollback(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<ImportResponse> {
    return this.imports.rollback(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
