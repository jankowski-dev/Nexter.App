import { Module } from '@nestjs/common';
import { BotTasksController } from './bot-tasks.controller';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController, BotTasksController],
  providers: [TasksService],
})
export class TasksModule {}
