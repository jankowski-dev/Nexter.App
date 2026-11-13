import { Module } from '@nestjs/common';
import { CoinGeckoClient } from './coingecko.client';
import { DexScreenerClient } from './dexscreener.client';
import { GeckoTerminalClient } from './geckoterminal.client';
import { MarketQuoteRefreshService } from './market-quote-refresh.service';
import { MarketQuoteService } from './market-quote.service';

@Module({
  providers: [
    CoinGeckoClient,
    DexScreenerClient,
    GeckoTerminalClient,
    MarketQuoteService,
    MarketQuoteRefreshService,
  ],
  exports: [CoinGeckoClient, GeckoTerminalClient, MarketQuoteService],
})
export class MarketDataCoreModule {}
