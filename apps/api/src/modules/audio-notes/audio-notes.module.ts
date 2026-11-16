import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotesModule } from '../notes/notes.module';
import { AudioNotesController } from './audio-notes.controller';
import { AudioNotesService } from './audio-notes.service';

@Module({
  imports: [AiModule, NotesModule],
  controllers: [AudioNotesController],
  providers: [AudioNotesService],
})
export class AudioNotesModule {}
