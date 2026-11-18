import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BotTasksController } from './bot-tasks.controller';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [SettingsModule],
  controllers: [TasksController, BotTasksController],
  providers: [TasksService],
})
export class TasksModule {}
