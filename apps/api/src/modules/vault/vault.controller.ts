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
  VaultConfig,
  VaultInitializeRequest,
  VaultItem,
  VaultItemCreateRequest,
  VaultItemUpdateRequest,
  VaultQuery,
  VaultResponse,
} from '@nexter/contracts';
import {
  vaultInitializeRequestSchema,
  vaultQuerySchema,
  vaultItemCreateRequestSchema,
  vaultItemUpdateRequestSchema,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { CurrentAuth } from '../auth/current-auth.decorator';
import type { AuthContext } from '../auth/auth.types';
import { VaultService } from './vault.service';

@ApiTags('vault')
@Controller('vault')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(vaultQuerySchema)) query: VaultQuery,
  ): Promise<VaultResponse> {
    return this.vault.get(auth.user.id, query);
  }

  @Post('initialize')
  initialize(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(vaultInitializeRequestSchema))
    body: VaultInitializeRequest,
    @Req() request: FastifyRequest,
  ): Promise<VaultConfig> {
    return this.vault.initialize(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('items')
  createItem(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(vaultItemCreateRequestSchema))
    body: VaultItemCreateRequest,
    @Req() request: FastifyRequest,
  ): Promise<VaultItem> {
    return this.vault.createItem(auth.user.id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Patch('items/:id')
  updateItem(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(vaultItemUpdateRequestSchema))
    body: VaultItemUpdateRequest,
    @Req() request: FastifyRequest,
  ): Promise<VaultItem> {
    return this.vault.updateItem(auth.user.id, id, body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
