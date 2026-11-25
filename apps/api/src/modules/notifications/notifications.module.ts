import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BotNotificationsController } from './bot-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TradingNotificationsService } from './trading-notifications.service';
import { ViberController } from './viber.controller';
import { ViberOutboxService } from './viber-outbox.service';

@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController, ViberController, BotNotificationsController],
  providers: [NotificationsService, ViberOutboxService, TradingNotificationsService],
  exports: [NotificationsService, ViberOutboxService, TradingNotificationsService],
})
export class NotificationsModule {}
