import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_USER_ID } from './bootstrap.constants';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.ensureDefaultUser();
    await this.ensureAtLeastOneClient();
  }

  private async ensureDefaultUser() {
    await this.prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      create: { id: DEFAULT_USER_ID },
      update: {},
    });
  }

  private async ensureAtLeastOneClient() {
    const existing = await this.prisma.client.findFirst({
      where: { userId: DEFAULT_USER_ID },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.client.create({
      data: {
        userId: DEFAULT_USER_ID,
        name: 'Default Client',
        defaults: {
          outputSize: '1536x1080',
          format: 'png',
          quality: 'high',
          inputFidelity: 'high',
        },
      },
    });
  }
}
