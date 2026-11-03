import { All, Controller, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../modules/auth/public.decorator';

@ApiExcludeController()
@Public()
@Controller()
export class ApiNotFoundController {
  @All('*')
  notFound(): never {
    throw new NotFoundException('Not found');
  }
}
