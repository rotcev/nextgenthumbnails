import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = normalizePort(process.env.PORT) ?? 3000;
  const host = process.env.HOST ?? "0.0.0.0";

  try {
    await app.listen(port, host);
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      Logger.error(`Port ${port} is already in use. Stop the other process or pick a new PORT.`);
    }
    throw err;
  }

  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  Logger.log(`API listening on http://${displayHost}:${port}`);
}
bootstrap();

function normalizePort(value: string | undefined) {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : null;
}

function corsOrigins() {
  // Allow list can be overridden: CORS_ORIGINS="http://localhost:5173,http://localhost:4173"
  const env = process.env.CORS_ORIGINS?.trim();
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);

  // Dev defaults:
  // - Vite dev server: 5173
  // - Vite preview: 4173
  // - allow other localhost ports for convenience in dev
  return [/^http:\/\/localhost:\d+$/];
}
