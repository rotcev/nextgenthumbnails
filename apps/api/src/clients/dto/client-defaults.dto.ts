import { IsIn } from 'class-validator';

export class ClientDefaultsDto {
  @IsIn(['1536x1080', '1280x720', '1024x1024', '1024x1536'])
  outputSize!: '1536x1080' | '1280x720' | '1024x1024' | '1024x1536';

  @IsIn(['png', 'jpeg', 'webp'])
  format!: 'png' | 'jpeg' | 'webp';

  @IsIn(['low', 'medium', 'high'])
  quality!: 'low' | 'medium' | 'high';

  @IsIn(['low', 'high'])
  inputFidelity!: 'low' | 'high';
}
