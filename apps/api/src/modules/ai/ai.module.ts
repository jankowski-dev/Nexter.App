import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSettingsService } from './ai-settings.service';
import { DeepSeekProvider } from './deepseek.provider';

@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiSettingsService, AiService, DeepSeekProvider],
  exports: [AiService, AiSettingsService, DeepSeekProvider],
})
export class AiModule {}
