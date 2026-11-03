import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const result = await this.exports.export(auth.user.id, dataset, format, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    reply.header('Content-Type', result.contentType);
    reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    reply.header('Cache-Control', 'no-store');
    return result.body;
  }
}
