import { Prisma } from "@prisma/client";

/**
 * Prisma has strict JSON input types. Our DTOs are plain objects, so we cast once
 * at the boundary to keep the rest of the codebase clean.
 */
export function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}


