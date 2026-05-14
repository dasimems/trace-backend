import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
} from '../../shared/constants';
import {
  AnthropicContentBlock,
  AnthropicCreateMessagePayload,
  AnthropicMessage,
  AnthropicResponse,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicToolUseBlock,
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

  // Tool-use loop. Sends messages + tools to Claude, executes any tool_use
  // blocks via the caller-provided handler, feeds the results back, and
  // repeats until Claude finishes (stop_reason=end_turn) or hits the
  // iteration cap.
  //
  // Caller responsibility: the handler must be idempotent and quick — every
  // tool call adds one Claude round-trip plus its own latency. Errors thrown
  // by the handler are surfaced to Claude as is_error tool_result blocks so
  // the model can recover (e.g. ask for clarification).
  async runTools(options: {
    systemBlocks: string[];
    messages: AnthropicMessage[];
    tools: AnthropicTool[];
    handler: (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    maxIterations?: number;
    maxTokens?: number;
    cacheFirstSystemBlock?: boolean;
  }): Promise<{
    finalText: string | null;
    transcript: AnthropicMessage[];
  }> {
    if (!this.enabled || !this.apiKey) {
      return { finalText: null, transcript: options.messages };
    }
    const {
      systemBlocks,
      tools,
      handler,
      maxIterations = 6,
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

    let messages: AnthropicMessage[] = [...options.messages];

    for (let iter = 0; iter < maxIterations; iter++) {
      const payload: AnthropicCreateMessagePayload = {
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages,
        tools,
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
          `Anthropic tools request failed: ${(error as Error).message}`,
        );
        return { finalText: null, transcript: messages };
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `Anthropic tools returned ${response.status}: ${body.slice(0, 500)}`,
        );
        return { finalText: null, transcript: messages };
      }
      const parsed = (await response.json()) as AnthropicResponse;
      if (parsed.usage) {
        this.logger.debug(
          `Anthropic tools iter=${iter} in=${parsed.usage.input_tokens} out=${parsed.usage.output_tokens} cache_read=${parsed.usage.cache_read_input_tokens ?? 0}`,
        );
      }

      // Always append the assistant turn — must preserve tool_use blocks
      // for the next iteration's context.
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: parsed.content as AnthropicContentBlock[],
        },
      ];

      if (parsed.stop_reason !== 'tool_use') {
        const textBlock = parsed.content.find(
          (b): b is { type: 'text'; text: string } => b.type === 'text',
        );
        return { finalText: textBlock?.text ?? null, transcript: messages };
      }

      const toolUses = parsed.content.filter(
        (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
      );
      if (toolUses.length === 0) {
        // stop_reason said tool_use but no blocks? bail safely.
        return { finalText: null, transcript: messages };
      }

      // Execute every requested tool, collect tool_result blocks.
      const toolResults: AnthropicContentBlock[] = [];
      for (const call of toolUses) {
        try {
          const result = await handler(call.name, call.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content:
              typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (error) {
          this.logger.warn(
            `Tool ${call.name} threw: ${(error as Error).message}`,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: (error as Error).message || 'Tool execution failed.',
            is_error: true,
          });
        }
      }
      messages = [
        ...messages,
        { role: 'user', content: toolResults },
      ];
    }

    // Hit iteration cap without an end_turn — return what we have. The
    // model exhausted its budget exploring; surface gracefully.
    this.logger.warn(
      `Anthropic tools loop hit maxIterations=${maxIterations}`,
    );
    return { finalText: null, transcript: messages };
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
