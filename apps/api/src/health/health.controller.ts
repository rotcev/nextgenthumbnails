import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('db')
  async db() {
    // `SELECT 1` is the simplest possible Postgres connectivity check.
    await this.prisma.$queryRaw`SELECT 1`;

    return { ok: true };
  }
}
