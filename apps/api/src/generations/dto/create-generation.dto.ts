import { IsIn, IsOptional, IsString, MinLength } from "class-validator";

export class CreateGenerationDto {
  // Multipart fields only (see controller). Files are uploaded as `subjectImages[]`.
  // Two JSON strings map those files to template slots and provide text inputs.
  //
  // Keeping this DTO tiny ensures the on-screen UI can stay extremely simple.
  // Validation beyond basic shape happens in the service.
  //
  // Example:
  // - templateId=...
  // - subjectSlotIdsJson=["left_person","right_person"]
  // - textsJson=[{"key":"title","value":"HELLO"}]

  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  @IsString()
  @MinLength(1)
  templateId!: string;

  // JSON-encoded array of slot IDs (aligned with uploaded files order).
  @IsString()
  subjectSlotIdsJson!: string;

  // JSON-encoded array of { key, value }.
  @IsString()
  textsJson!: string;

  // JSON-encoded object of customization selections (optional).
  @IsOptional()
  @IsString()
  customizationsJson?: string;

  @IsOptional()
  @IsString()
  userNotes?: string;

  @IsOptional()
  @IsIn(["png", "jpeg", "webp"])
  format?: "png" | "jpeg" | "webp";
}


