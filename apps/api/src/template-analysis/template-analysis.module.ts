import { Global, Module } from '@nestjs/common';
import { TemplateAnalysisService } from './template-analysis.service';

@Global()
@Module({
  providers: [TemplateAnalysisService],
  exports: [TemplateAnalysisService],
})
export class TemplateAnalysisModule {}
