import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Asset, AssetsResponse } from '@nexter/contracts';
import { AssetsService } from './assets.service';

@ApiTags('accounting')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  async list(): Promise<AssetsResponse> {
    return { assets: await this.assets.list() };
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Asset> {
    return this.assets.get(id);
  }
}
