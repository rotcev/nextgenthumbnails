import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { BootstrapService } from './bootstrap/bootstrap.service';
import { ClientsModule } from './clients/clients.module';
import { TemplatesModule } from './templates/templates.module';
import { GenerationsModule } from './generations/generations.module';
import { StorageModule } from './storage/storage.module';
import { TemplateAnalysisModule } from './template-analysis/template-analysis.module';
import { ImageGenerationModule } from './image-generation/image-generation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'storage'),
      serveRoot: '/storage',
    }),
    PrismaModule,
    StorageModule,
    TemplateAnalysisModule,
    ImageGenerationModule,
    ClientsModule,
    TemplatesModule,
    GenerationsModule,
  ],
  controllers: [HealthController],
  providers: [BootstrapService],
})
export class AppModule {}
