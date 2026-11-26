import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MarketTickerResponse } from '@nexter/contracts';
import { CoinGeckoClient } from './coingecko.client';

@ApiTags('market')
@Controller('market')
export class MarketTickerController {
  constructor(private readonly coingecko: CoinGeckoClient) {}

  @Get('ticker')
  async ticker(): Promise<MarketTickerResponse> {
    const items = await this.coingecko.getTopMarkets(10);
    return { items };
  }
}
