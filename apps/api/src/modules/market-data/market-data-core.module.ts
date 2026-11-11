import { Module } from '@nestjs/common';
import { CoinGeckoClient } from './coingecko.client';
import { DexScreenerClient } from './dexscreener.client';
import { MarketQuoteRefreshService } from './market-quote-refresh.service';
import { MarketQuoteService } from './market-quote.service';

@Module({
  providers: [CoinGeckoClient, DexScreenerClient, MarketQuoteService, MarketQuoteRefreshService],
  exports: [CoinGeckoClient, MarketQuoteService],
})
export class MarketDataCoreModule {}
