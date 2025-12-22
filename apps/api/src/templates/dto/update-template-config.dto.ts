import { IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class TemplateSubjectSlotDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsIn(["replace", "add", "optional"])
  behavior!: "replace" | "add" | "optional";
}

class TemplateTextRegionDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsString()
  @MinLength(1)
  key!: string;

  @IsIn([true, false])
  required!: boolean;
}

export class UpdateTemplateConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSubjectSlotDto)
  subjectSlots!: TemplateSubjectSlotDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTextRegionDto)
  textRegions!: TemplateTextRegionDto[];

  @IsIn(["1536x1080", "1280x720", "1024x1024", "1024x1536"])
  outputSize!: "1536x1080" | "1280x720" | "1024x1024" | "1024x1536";
}


