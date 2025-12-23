import {
  IsHexColor,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ClientDefaultsDto } from './client-defaults.dto';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ValidateNested()
  @Type(() => ClientDefaultsDto)
  defaults!: ClientDefaultsDto;
}
