import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { TemplatesService } from "./templates.service";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { UpdateTemplateConfigDto } from "./dto/update-template-config.dto";
import { CopyTemplateDto } from "./dto/copy-template.dto";

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get("clients/:clientId/templates")
  listByClient(@Param("clientId") clientId: string) {
    return this.templates.listByClient(clientId);
  }

  @Post("clients/:clientId/templates")
  create(@Param("clientId") clientId: string, @Body() dto: CreateTemplateDto) {
    return this.templates.create(clientId, dto);
  }

  @Post("clients/:clientId/templates/upload")
  @UseInterceptors(FileInterceptor("image"))
  uploadAndAnalyze(
    @Param("clientId") clientId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(png|jpg|jpeg|webp)$/i }),
        ],
        fileIsRequired: true,
      }),
    )
    image: Express.Multer.File,
    @Body("name") name?: string,
  ) {
    return this.templates.uploadAndAnalyze(clientId, {
      name,
      originalName: image.originalname,
      bytes: image.buffer,
    });
  }

  @Get("templates/:id")
  getById(@Param("id") id: string) {
    return this.templates.getById(id);
  }

  @Put("templates/:id/config")
  updateConfig(@Param("id") id: string, @Body() dto: UpdateTemplateConfigDto) {
    return this.templates.updateConfig(id, dto);
  }

  @Post("templates/:id/copy")
  copy(@Param("id") id: string, @Body() dto: CopyTemplateDto) {
    return this.templates.copy(id, dto);
  }

  @Delete("templates/:id")
  archive(@Param("id") id: string) {
    return this.templates.archive(id);
  }

  @Post("templates/:id/rebuild-inputs")
  rebuildInputs(@Param("id") id: string) {
    return this.templates.rebuildInputsFromReconstructionSpec(id);
  }

  @Post("templates/:id/reanalyze")
  reanalyze(@Param("id") id: string) {
    return this.templates.reanalyze(id);
  }
}


