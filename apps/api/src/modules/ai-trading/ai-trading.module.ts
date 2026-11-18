import { Module } from '@nestjs/common';
import { AiTradingController } from './ai-trading.controller';
import { AiTradingService } from './ai-trading.service';

@Module({
  controllers: [AiTradingController],
  providers: [AiTradingService],
})
export class AiTradingModule {}
