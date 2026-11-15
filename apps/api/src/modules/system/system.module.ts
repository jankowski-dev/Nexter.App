import { Module } from '@nestjs/common';
import { DataQualityService } from './data-quality.service';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  controllers: [SystemController],
  providers: [SystemService, DataQualityService],
})
export class SystemModule {}
