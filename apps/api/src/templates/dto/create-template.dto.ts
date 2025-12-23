import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class TemplateSubjectSlotDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsIn(['replace', 'add', 'optional'])
  behavior!: 'replace' | 'add' | 'optional';
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

class TemplateConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateSubjectSlotDto)
  subjectSlots!: TemplateSubjectSlotDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTextRegionDto)
  textRegions!: TemplateTextRegionDto[];

  @IsIn(['1536x1080', '1280x720', '1024x1024', '1024x1536'])
  outputSize!: '1536x1080' | '1280x720' | '1024x1024' | '1024x1536';
}

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsIn([true, false])
  isSpecial?: boolean;

  @ValidateNested()
  @Type(() => TemplateConfigDto)
  config!: TemplateConfigDto;

  @IsIn(['1536x1080', '1280x720', '1024x1024', '1024x1536'])
  outputSize!: '1536x1080' | '1280x720' | '1024x1024' | '1024x1536';

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
