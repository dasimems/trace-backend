import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import {
  COOKIE_SECRET,
  CORS_ORIGINS,
  NODE_ENV,
  PROXY_IPS,
} from './shared/constants';
import { NodeEnv } from './shared/enums/enums';
import * as http from 'http';
import { PassThrough } from 'stream';
import compression from '@fastify/compress';
import { constants } from 'zlib';
import fastifyCookie from '@fastify/cookie';
import { UUIDGlobalParamPipe } from './common/url/url.pipe';
import { ValidationPipe } from './common/validation/validation.pipe';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const isProd = process?.env?.[NODE_ENV] === NodeEnv.PRODUCTION;
  const rawProxy = process?.env?.[PROXY_IPS]?.trim() ?? '';
  let trustProxy: boolean | number | string[];
  if (!rawProxy || rawProxy === '*' || rawProxy.toLowerCase() === 'true') {
    trustProxy = true;
  } else if (rawProxy.toLowerCase() === 'false') {
    trustProxy = false;
  } else if (/^\d+$/.test(rawProxy)) {
    trustProxy = Number(rawProxy);
  } else {
    trustProxy = rawProxy
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
  }
  const adapter = new FastifyAdapter({
    trustProxy,
    logger: isProd ? false : { level: 'info' },
    ignoreTrailingSlash: true,
    maxParamLength: 100,
    bodyLimit: 10485760, // 10MB
    keepAliveTimeout: 5000,
    connectionTimeout: 5000,
    pluginTimeout: 120000,
    requestIdHeader: false,
    requestIdLogLabel: 'reqId',
    disableRequestLogging: isProd,
    http2: true,
    serverFactory: (handler) => {
      const server = http.createServer(handler);
      server.keepAliveTimeout = 5000;
      server.headersTimeout = 6000;
      server.maxHeadersCount = 100;
      server.timeout = 10000;
      return server;
    },
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { snapshot: true, rawBody: true },
  );

  // Allow multipart so Fastify doesn't return 415. Pass payload through for
  // @nest-lab/fastify-multer interceptors (they parse and write to disk).
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(
    /^multipart\/form-data/,
    (
      req: {
        raw: { pipe: (dest: NodeJS.WritableStream) => unknown };
        _multipartPayload?: NodeJS.ReadableStream;
      },
      payload: NodeJS.ReadableStream,
      done: (err: Error | null, body?: object) => void,
    ) => {
      const passThrough = new PassThrough();
      (payload as NodeJS.ReadableStream).pipe(passThrough);
      (req as Record<string, unknown>)._multipartPayload = passThrough;
      const raw = req.raw as NodeJS.ReadableStream & {
        pipe: (dest: NodeJS.WritableStream) => unknown;
      };
      const origPipe = raw.pipe.bind(raw);
      raw.pipe = function (dest: NodeJS.WritableStream) {
        const stream = (req as Record<string, unknown>)
          ._multipartPayload as NodeJS.ReadableStream;
        return stream
          ? (
              stream as NodeJS.ReadableStream & {
                pipe: (d: NodeJS.WritableStream) => unknown;
              }
            ).pipe(dest)
          : origPipe(dest);
      };
      done(null, {});
    },
  );

  const configService = app.get(ConfigService);

  const corsOrigins = configService.get<string>(CORS_ORIGINS);
  const allowedOrigins = (corsOrigins?.split(',') ?? []).filter(Boolean);

  const cookieSecret = configService.get<string>(COOKIE_SECRET);

  await app.register(fastifyCookie, {
    secret: cookieSecret || 'my-secret',
  });

  // Don't increase brotli quality past 4 — higher quality eats CPU and hurts
  // response times more than the bandwidth saving is worth.
  await app.register(compression, {
    brotliOptions: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
  });

  await app.register(helmet);
  const port: number = configService.getOrThrow<number>('app.http.port', 4092);
  const globalPrefix: string =
    configService.getOrThrow<string>('app.globalPrefix');
  const versioningPrefix: string = configService.getOrThrow<string>(
    'app.versioning.prefix',
  );
  const version: string = configService.getOrThrow<string>(
    'app.versioning.version',
  );

  app.enableShutdownHooks();

  const logger = new Logger();

  app.setGlobalPrefix(globalPrefix);

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'Cache-Control',
      'X-CSRF-Token',
      'X-Access-Token',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Credentials',
      'X-Client-Version',
    ],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 200,
    maxAge: 86400,
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: version,
    prefix: versioningPrefix,
  });

  // Globally enforces that any route param named `id` or `contentId` is a UUID.
  // Add other UUID param names here if your routes use them.
  app.useGlobalPipes(new UUIDGlobalParamPipe(['id', 'contentId']));

  /* Global validating of class dto errors and making them parsed in a readable format
     therefore making it easy for the frontend to inject it into their form errors
     and calls using the name of the field.

     E.G {
       message: 'Invalid fields detected',
       errors: { firstName: string, lastName: string }
     }
  */
  app.useGlobalPipes(new ValidationPipe());

  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Trace')
      .setDescription('Trace API documentation')
      .setVersion(version)
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          in: 'header',
          name: 'Authorization',
          description:
            'Paste the access token returned by /auth/sign-up or /auth/sign-in.',
        },
        'access-token',
      )
      .addTag('Auth', 'Sign-up, sign-in, and virtual account onboarding')
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, documentFactory);
  }

  await app.listen(port, '::');

  logger.log(`==========================================================`);
  logger.log(
    `🚀 Http Server running on ${await app.getUrl()}${globalPrefix}/${versioningPrefix}${version}`,
    'NestApplication',
  );
  logger.log(`==========================================================`);
}
bootstrap();
