import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { GenerationsService } from "./generations.service";
import { CreateGenerationDto } from "./dto/create-generation.dto";

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class GenerationsController {
  constructor(private readonly generations: GenerationsService) {}

  @Get("clients/:clientId/generations")
  listByClient(@Param("clientId") clientId: string) {
    return this.generations.listByClient(clientId);
  }

  @Post("clients/:clientId/generations")
  @UseInterceptors(FilesInterceptor("subjectImages", 10))
  create(
    @Param("clientId") clientId: string,
    @Body() dto: CreateGenerationDto,
    @UploadedFiles() subjectImages: Express.Multer.File[],
  ) {
    return this.generations.createFromMultipart(clientId, dto, subjectImages);
  }
}


