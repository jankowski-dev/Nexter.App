import { Module } from '@nestjs/common';
import { BinanceClient } from './binance.client';
import { CoinGeckoClient } from './coingecko.client';
import { DexScreenerClient } from './dexscreener.client';
import { GeckoTerminalClient } from './geckoterminal.client';
import { MarketQuoteRefreshService } from './market-quote-refresh.service';
import { MarketQuoteService } from './market-quote.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [
    BinanceClient,
    CoinGeckoClient,
    DexScreenerClient,
    GeckoTerminalClient,
    MarketQuoteService,
    MarketQuoteRefreshService,
  ],
  exports: [BinanceClient, CoinGeckoClient, GeckoTerminalClient, MarketQuoteService],
})
export class MarketDataCoreModule {}
