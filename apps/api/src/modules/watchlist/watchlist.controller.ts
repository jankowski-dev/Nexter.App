import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  WatchlistCreateRequest,
  WatchlistEntry,
  WatchlistFromContractRequest,
  WatchlistGroup,
  WatchlistGroupCreateRequest,
  WatchlistGroupUpdateRequest,
  WatchlistGroupsResponse,
  WatchlistListQuery,
  WatchlistResponse,
  WatchlistTokenSearchQuery,
  WatchlistTokenSearchResult,
  WatchlistUpdateRequest,
} from '@nexter/contracts';
import {
  watchlistCreateRequestSchema,
  watchlistFromContractRequestSchema,
  watchlistGroupCreateRequestSchema,
  watchlistGroupUpdateRequestSchema,
  watchlistListQuerySchema,
  watchlistTokenSearchQuerySchema,
  watchlistUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { WatchlistService } from './watchlist.service';

@ApiTags('watchlist')
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(watchlistListQuerySchema)) query: WatchlistListQuery,
  ): Promise<WatchlistResponse> {
    return this.watchlist.list(auth.user.id, query);
  }

  @Get('groups')
  listGroups(@CurrentAuth() auth: AuthContext): Promise<WatchlistGroupsResponse> {
    return this.watchlist.listGroups(auth.user.id);
  }

  @Post('groups')
  createGroup(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(watchlistGroupCreateRequestSchema))
    body: WatchlistGroupCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistGroup> {
    return this.watchlist.createGroup(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('groups/:id')
  updateGroup(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(watchlistGroupUpdateRequestSchema))
    body: WatchlistGroupUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistGroup> {
    return this.watchlist.updateGroup(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.watchlist.deleteGroup(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('icon')
  async icon(
    @CurrentAuth() _auth: AuthContext,
    @Query('url') url: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const icon = await this.watchlist.fetchIcon(url);
    void reply.header('content-type', icon.contentType);
    void reply.header('cache-control', 'public, max-age=86400, immutable');
    return icon.body;
  }

  @Get('search')
  search(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(watchlistTokenSearchQuerySchema))
    query: WatchlistTokenSearchQuery,
  ): Promise<WatchlistTokenSearchResult> {
    return this.watchlist.searchToken(auth.user.id, query);
  }

  @Post('from-contract')
  fromContract(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(watchlistFromContractRequestSchema))
    body: WatchlistFromContractRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistEntry> {
    return this.watchlist.fromContract(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(watchlistCreateRequestSchema))
    body: WatchlistCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistEntry> {
    return this.watchlist.create(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(watchlistUpdateRequestSchema))
    body: WatchlistUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<WatchlistEntry> {
    return this.watchlist.update(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.watchlist.archive(auth.user.id, id, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
