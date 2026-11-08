import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ReportsQuery } from '@nexter/contracts';
import { reportsQuerySchema } from '@nexter/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { ExportService } from './export.service';

@ApiTags('export')
@Controller('export')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get(':dataset.:format')
  async download(
    @CurrentAuth() auth: AuthContext,
    @Param('dataset') dataset: string,
    @Param('format') format: string,
    @Query(new ZodValidationPipe(reportsQuerySchema)) query: ReportsQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const result = await this.exports.export(auth.user.id, dataset, format, query, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    reply.header('Content-Type', result.contentType);
    reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    reply.header('Cache-Control', 'no-store');
    return result.body;
  }
}
