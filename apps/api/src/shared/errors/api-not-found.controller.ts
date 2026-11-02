import { All, Controller, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class ApiNotFoundController {
  @All('*')
  notFound(): never {
    throw new NotFoundException('Not found');
  }
}
