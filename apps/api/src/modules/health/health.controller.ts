import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@nexter/contracts';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @ApiOkResponse({ description: 'Liveness probe' })
  getHealth(): HealthResponse {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Readiness probe' })
  @ApiServiceUnavailableResponse({ description: 'Database is not ready' })
  getReady(): Promise<ReadinessResponse> {
    return this.healthService.readiness();
  }
}
