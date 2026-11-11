import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { env } from '../../shared/config/env';
import { MarketQuoteService } from './market-quote.service';

@Injectable()
export class MarketQuoteRefreshService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MarketQuoteRefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly quotes: MarketQuoteService) {}

  onApplicationBootstrap(): void {
    if (!env.MARKET_QUOTES_ENABLED || env.NODE_ENV === 'test') return;

    this.initialTimer = setTimeout(() => {
      void this.tick();
    }, 3000);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      void this.tick();
    }, env.MARKET_QUOTE_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.quotes.refreshAll();
    } catch (error) {
      this.logger.warn(
        `Market quote refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      this.running = false;
    }
  }
}
