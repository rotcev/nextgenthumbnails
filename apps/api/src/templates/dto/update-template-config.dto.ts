import {
  IsArray,
  IsIn,
  IsNumber,
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

class TemplatePolygonPointDto {
  @IsNumber()
  xPct!: number;

  @IsNumber()
  yPct!: number;
}

class TemplatePolygonDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  color!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplatePolygonPointDto)
  points!: TemplatePolygonPointDto[];
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

  @IsIn(['1536x1080', '1280x720', '1024x1024', '1024x1536'])
  outputSize!: '1536x1080' | '1280x720' | '1024x1024' | '1024x1536';

  // Optional polygon overlays used for mask-based precision (special templates).
  // Coordinates are stored as percentages of the template canvas.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplatePolygonDto)
  polygons?: TemplatePolygonDto[];
}
