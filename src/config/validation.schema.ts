import * as Joi from 'joi';
import {
  AUTH_HASH_KEY,
  AUTH_SECRET_KEY,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
  COOKIE_SECRET,
  CORS_ORIGINS,
  DATABASE_URL,
  NODE_ENV,
  OTP_HASH_KEY,
  OTP_HASH_SALT,
  OTP_SECRET_KEY,
  PASSWORD_HASH,
  PASSWORD_SALT,
  PASSWORD_SECRET,
  PORT,
  PROXY_IPS,
  REDIS_CONNECTION_STRING,
  SENDGRID_API_KEY,
  SENDGRID_SENDER_EMAIL,
  SENDGRID_SENDER_NAME,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  APPLE_CLIENT_ID,
  GOOGLE_CLIENT_ID,
  SQUAD_BASE_URL,
  SQUAD_BENEFICIARY_ACCOUNT,
  SQUAD_SECRET_KEY,
  SUPPORT_EMAIL,
  SUPPORT_MOBILE_NUMBER,
} from '../shared/constants';
import {
  passwordRegexp,
  phoneNumberRegexp,
  postgresRegexp,
  proxyIpRegexp,
  redisRegexp,
} from '../shared/regex';
import { NodeEnv } from '../shared/enums/enums';

// Validation schema is referenced as `validationSchema` by ConfigModule.forRoot.
// It will block app startup if any required env is missing or malformed, and the
// error message will tell you exactly which key is wrong.
export const validationSchema = Joi.object({
  [NODE_ENV]: Joi.string()
    .valid(...Object.values(NodeEnv))
    .default(NodeEnv.DEVELOPMENT)
    .label(NODE_ENV)
    .messages({
      'any.required': `${NODE_ENV} is required.`,
      'any.only': `${NODE_ENV} must be one of development, production, or test.`,
      'string.base': `${NODE_ENV} must be a string.`,
    }),
  [PORT]: Joi.number()
    .default(3333)
    .label(PORT)
    .messages({
      'number.base': `${PORT} must be a number.`,
    }),

  [DATABASE_URL]: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .pattern(postgresRegexp)
    .required()
    .label(DATABASE_URL)
    .messages({
      'string.uri': `${DATABASE_URL} must be a valid PostgreSQL connection URI.`,
      'string.pattern.base': `${DATABASE_URL} must be a valid postgres sql uri or connection string and must include it's username, password, host, and database name.`,
      'any.required': `${DATABASE_URL} is required.`,
    }),
  [COOKIE_SECRET]: Joi.string().min(32).required().messages({
    'string.min': 'The cookie secret must be at least 32 characters long.',
    'any.required':
      'The cookie secret is not set. Please set the COOKIE_SECRET environment variable.',
  }),
  [PASSWORD_SECRET]: Joi.string()
    .required()
    .label(PASSWORD_SECRET)
    .messages({
      'any.required': `${PASSWORD_SECRET} is required.`,
    }),
  [PASSWORD_HASH]: Joi.string()
    .required()
    .label(PASSWORD_HASH)
    .messages({
      'any.required': `${PASSWORD_HASH} is required.`,
    }),
  [PASSWORD_SALT]: Joi.string()
    .required()
    .label(PASSWORD_SALT)
    .pattern(passwordRegexp)
    .messages({
      'any.required': `${PASSWORD_SALT} is required.`,
      'string.pattern.base': `${PASSWORD_SALT} must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character (e.g. !@#$%^&*)`,
    }),
  [OTP_HASH_KEY]: Joi.string()
    .required()
    .label(OTP_HASH_KEY)
    .messages({
      'any.required': `${OTP_HASH_KEY} is required.`,
    }),
  [OTP_SECRET_KEY]: Joi.string()
    .required()
    .label(OTP_SECRET_KEY)
    .messages({
      'any.required': `${OTP_SECRET_KEY} is required.`,
    }),
  [OTP_HASH_SALT]: Joi.string()
    .required()
    .label(OTP_HASH_SALT)
    .pattern(passwordRegexp)
    .messages({
      'any.required': `${OTP_HASH_SALT} is required.`,
      'string.pattern.base': `${OTP_HASH_SALT} must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character (e.g. !@#$%^&*)`,
    }),
  [AUTH_HASH_KEY]: Joi.string()
    .required()
    .label(AUTH_HASH_KEY)
    .messages({
      'any.required': `${AUTH_HASH_KEY} is required.`,
    }),
  [AUTH_SECRET_KEY]: Joi.string()
    .required()
    .label(AUTH_SECRET_KEY)
    .messages({
      'any.required': `${AUTH_SECRET_KEY} is required.`,
    }),
  [REDIS_CONNECTION_STRING]: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .pattern(redisRegexp)
    .required()
    .label(REDIS_CONNECTION_STRING)
    .messages({
      'string.uri': `${REDIS_CONNECTION_STRING} must start with redis:// or rediss:// and be a valid URI.`,
      'string.pattern.base': `${REDIS_CONNECTION_STRING} must be a valid redis connection string and must include a valid host and optionally a port and database index.`,
      'any.required': `${REDIS_CONNECTION_STRING} is required.`,
    }),
  [PROXY_IPS]: Joi.string()
    .default('*')
    .pattern(proxyIpRegexp)
    .label(PROXY_IPS)
    .messages({
      'string.pattern.base': `${PROXY_IPS} must be "*"/"true" (trust all), "false" (trust none), a hop count (e.g. "1"), or a comma-separated list of valid ip addresses (e.g. "1.1.1.1,0.0.0.0")`,
    }),
  [CORS_ORIGINS]: Joi.string().allow('').default(''),
  [CLOUDINARY_CLOUD_NAME]: Joi.string().required().messages({
    'any.required': `${CLOUDINARY_CLOUD_NAME} is required.`,
  }),
  [CLOUDINARY_API_KEY]: Joi.string().required().messages({
    'any.required': `${CLOUDINARY_API_KEY} is required.`,
  }),
  [CLOUDINARY_API_SECRET]: Joi.string().required().messages({
    'any.required': `${CLOUDINARY_API_SECRET} is required.`,
  }),
  [SENDGRID_API_KEY]: Joi.string()
    .pattern(/^SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/)
    .required()
    .label(SENDGRID_API_KEY)
    .messages({
      'string.pattern.base': `${SENDGRID_API_KEY} must be a valid SendGrid API key starting with 'SG.'`,
      'any.required': `${SENDGRID_API_KEY} is required.`,
    }),
  [SENDGRID_SENDER_EMAIL]: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .label(SENDGRID_SENDER_EMAIL)
    .messages({
      'string.email': `${SENDGRID_SENDER_EMAIL} must be a valid email address.`,
      'any.required': `${SENDGRID_SENDER_EMAIL} is required.`,
    }),
  [SENDGRID_SENDER_NAME]: Joi.string()
    .default('Trace')
    .label(SENDGRID_SENDER_NAME),
  [SUPPORT_EMAIL]: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .label(SUPPORT_EMAIL)
    .messages({
      'string.email': `${SUPPORT_EMAIL} must be a valid email address.`,
      'any.required': `${SUPPORT_EMAIL} is required.`,
    }),
  [SUPPORT_MOBILE_NUMBER]: Joi.string()
    .pattern(phoneNumberRegexp)
    .required()
    .messages({
      'string.pattern.base': `${SUPPORT_MOBILE_NUMBER} must be in E.164 format, e.g., +1234567890`,
      'any.required': `${SUPPORT_MOBILE_NUMBER} is required`,
    }),
  [SQUAD_SECRET_KEY]: Joi.string()
    .optional()
    .allow('')
    .label(SQUAD_SECRET_KEY)
    .messages({
      // Optional — when blank, /auth/account (Squad virtual account creation)
      // and /wallet/transfer return 503 instead of crashing. Other endpoints
      // (insights, copilot, dev seeder) keep working.
    }),
  [SQUAD_BASE_URL]: Joi.string()
    .uri({ scheme: ['https'] })
    .default('https://sandbox-api-d.squadco.com')
    .label(SQUAD_BASE_URL)
    .messages({
      'string.uri': `${SQUAD_BASE_URL} must be an https URL (e.g. https://sandbox-api-d.squadco.com or https://api-d.squadco.com).`,
    }),
  [SQUAD_BENEFICIARY_ACCOUNT]: Joi.string()
    .length(10)
    .pattern(/^\d{10}$/)
    .optional()
    .allow('')
    .label(SQUAD_BENEFICIARY_ACCOUNT)
    .messages({
      'string.pattern.base': `${SQUAD_BENEFICIARY_ACCOUNT} must be a 10-digit GTBank account number.`,
      'string.length': `${SQUAD_BENEFICIARY_ACCOUNT} must be exactly 10 digits.`,
    }),
  [ANTHROPIC_API_KEY]: Joi.string()
    .optional()
    .allow('')
    .label(ANTHROPIC_API_KEY)
    .messages({
      // Optional — if missing, the insights module falls back to deterministic
      // narrative copy. Set this to enable Claude-generated summaries and
      // recommendation phrasing.
    }),
  [ANTHROPIC_MODEL]: Joi.string()
    .default('claude-sonnet-4-6')
    .label(ANTHROPIC_MODEL),
  // OAuth client IDs are the `aud` claim on ID tokens from each provider.
  // Both optional — if missing, the corresponding /auth/oauth/<provider>
  // endpoint returns 503 instead of crashing.
  [GOOGLE_CLIENT_ID]: Joi.string()
    .optional()
    .allow('')
    .label(GOOGLE_CLIENT_ID),
  [APPLE_CLIENT_ID]: Joi.string()
    .optional()
    .allow('')
    .label(APPLE_CLIENT_ID),
});
