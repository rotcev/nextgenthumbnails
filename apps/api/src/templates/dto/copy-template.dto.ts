import { IsOptional, IsString, MinLength } from "class-validator";

export class CopyTemplateDto {
  @IsString()
  @MinLength(1)
  targetClientId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}


