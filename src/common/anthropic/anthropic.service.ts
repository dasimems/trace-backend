import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
} from '../../shared/constants';
import {
  AnthropicCreateMessagePayload,
  AnthropicMessage,
  AnthropicResponse,
  AnthropicTextBlock,
} from './anthropic.dto';

interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  // Whether to attach cache_control to the system prompt. Defaults to true —
  // Sonnet 4.6 caches at 2048+ tokens, so it's free to opt in.
  cacheSystem?: boolean;
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly baseUrl = 'https://api.anthropic.com';
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>(ANTHROPIC_API_KEY);
    this.apiKey = key && key.trim() !== '' ? key : undefined;
    this.model =
      this.configService.get<string>(ANTHROPIC_MODEL) || 'claude-sonnet-4-6';
    this.enabled = !!this.apiKey;
  }

  isEnabled() {
    return this.enabled;
  }

  // Returns null when disabled (no API key) so callers can transparently fall
  // back to deterministic copy. Returns the plain assistant text on success.
  async generateText(options: GenerateOptions): Promise<string | null> {
    if (!this.enabled || !this.apiKey) return null;

    const { systemPrompt, userPrompt, maxTokens = 1024, cacheSystem = true } =
      options;

    const systemBlock: AnthropicTextBlock = {
      type: 'text',
      text: systemPrompt,
      ...(cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}),
    };

    const payload: AnthropicCreateMessagePayload = {
      model: this.model,
      max_tokens: maxTokens,
      system: [systemBlock],
      messages: [{ role: 'user', content: userPrompt }],
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      this.logger.error(
        `Anthropic request failed: ${(error as Error).message}`,
      );
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `Anthropic returned ${response.status}: ${body.slice(0, 500)}`,
      );
      return null;
    }

    const parsed = (await response.json()) as AnthropicResponse;
    if (parsed.usage) {
      this.logger.debug(
        `Anthropic usage: in=${parsed.usage.input_tokens} out=${parsed.usage.output_tokens} cache_read=${parsed.usage.cache_read_input_tokens ?? 0} cache_write=${parsed.usage.cache_creation_input_tokens ?? 0}`,
      );
    }

    const textBlock = parsed.content.find(
      (block): block is { type: 'text'; text: string } => block.type === 'text',
    );
    return textBlock?.text ?? null;
  }

  // Multi-turn chat with explicit message history + optional multi-block
  // system prompts. Use this when you want to cache the stable portion of the
  // system prompt while keeping per-request context (timestamps, current
  // balance, recent transactions) uncached. The first block gets
  // cache_control; later blocks render after the breakpoint and aren't
  // cached. Pass `cacheFirstSystemBlock: false` to disable.
  async generateChat(options: {
    systemBlocks: string[];
    messages: AnthropicMessage[];
    maxTokens?: number;
    cacheFirstSystemBlock?: boolean;
  }): Promise<string | null> {
    if (!this.enabled || !this.apiKey) return null;
    const {
      systemBlocks,
      messages,
      maxTokens = 1024,
      cacheFirstSystemBlock = true,
    } = options;

    const system: AnthropicTextBlock[] = systemBlocks.map((text, index) => ({
      type: 'text',
      text,
      ...(cacheFirstSystemBlock && index === 0
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));

    const payload: AnthropicCreateMessagePayload = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      this.logger.error(
        `Anthropic chat request failed: ${(error as Error).message}`,
      );
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `Anthropic chat returned ${response.status}: ${body.slice(0, 500)}`,
      );
      return null;
    }
    const parsed = (await response.json()) as AnthropicResponse;
    if (parsed.usage) {
      this.logger.debug(
        `Anthropic chat usage: in=${parsed.usage.input_tokens} out=${parsed.usage.output_tokens} cache_read=${parsed.usage.cache_read_input_tokens ?? 0} cache_write=${parsed.usage.cache_creation_input_tokens ?? 0}`,
      );
    }
    const textBlock = parsed.content.find(
      (block): block is { type: 'text'; text: string } => block.type === 'text',
    );
    return textBlock?.text ?? null;
  }

  // Convenience wrapper: prompt Claude to return JSON and parse it. Returns
  // null on missing key, transport failure, or invalid JSON.
  async generateJson<T>(options: GenerateOptions): Promise<T | null> {
    const text = await this.generateText(options);
    if (!text) return null;
    // Strip accidental ```json fences in case the model wraps output despite
    // instructions.
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      this.logger.warn(
        `Anthropic returned non-JSON output: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
