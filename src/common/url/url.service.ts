import { Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

@Injectable()
export class UrlService {
  getUserAgent(req: FastifyRequest) {
    return req?.headers['user-agent'] || 'default-agent';
  }
  getIpAddress(req: FastifyRequest) {
    const ip =
      req?.ip ||
      req?.headers['x-forwarded-for']
        ?.toString()
        ?.split(',')
        ?.map((ip) => ip?.trim())?.[0];

    return ip || 'no-ip';
  }

  getUrlOrigin(req: FastifyRequest) {
    return req?.headers?.origin;
  }

  getIsMobile(req: FastifyRequest) {
    const header = req?.headers?.['x-mobile'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value === undefined || value === null || value === '') return true;
    return value.toString().toLowerCase() !== 'false';
  }
}
