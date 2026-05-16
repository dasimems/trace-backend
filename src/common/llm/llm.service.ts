import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
} from '../../shared/constants';
import {
  LlmChatResponse,
  LlmCreateChatPayload,
  LlmMessage,
  LlmTool,
  LlmToolCall,
} from './llm.dto';

interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  // No-op flag — kept for API compatibility with the old AnthropicService
  // signature. OpenAI-compatible providers auto-cache prompt prefixes; there
  // are no explicit breakpoints to set.
  cacheSystem?: boolean;
}

// OpenAI-compatible LLM client. Talks to any provider that implements
// POST /v1/chat/completions. Defaults target OpenAI; override via env vars:
//   LLM_BASE_URL  = https://openrouter.ai/api/v1   (OpenRouter)
//                 = https://api.groq.com/openai/v1 (Groq)
//                 = https://api.anthropic.com/v1/  (Anthropic's OpenAI shim)
//                 = http://localhost:11434/v1      (Ollama)
//   LLM_MODEL     = whatever the provider accepts
//   LLM_API_KEY   = provider key. Blank = AI features fall back gracefully.
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>(LLM_API_KEY);
    this.apiKey = key && key.trim() !== '' ? key : undefined;
    this.baseUrl = (
      this.configService.get<string>(LLM_BASE_URL) ||
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.model =
      this.configService.get<string>(LLM_MODEL) || 'gpt-4o-mini';
    this.enabled = !!this.apiKey;
  }

  isEnabled() {
    return this.enabled;
  }

  // ─── Single-turn text completion ──────────────────────────────────────

  async generateText(options: GenerateOptions): Promise<string | null> {
    const response = await this.chat({
      // DigitalOcean Gradient Agents already inject the agent's instructions
      // from the dashboard as the system prompt server-side. We pass our
      // mode-specific instructions as a leading assistant turn (priming the
      // model as if it has committed to these rules) instead of sending a
      // second `system` role — DO rejects/merges that.
      messages: [
        { role: 'assistant', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      maxTokens: options.maxTokens ?? 1024,
    });
    return response?.choices[0]?.message?.content ?? null;
  }

  // ─── Single-turn JSON-mode completion ────────────────────────────────

  async generateJson<T>(options: GenerateOptions): Promise<T | null> {
    const response = await this.chat({
      messages: [
        { role: 'assistant', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      maxTokens: options.maxTokens ?? 1024,
      responseFormat: 'json_object',
    });
    const text = response?.choices[0]?.message?.content;
    if (!text) return null;
    // Strip accidental ```json fences in case the model wraps output.
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      this.logger.warn(
        `LLM returned non-JSON output: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // ─── Multi-turn chat with multi-block system-style instructions ──────
  // DO Gradient owns the actual system prompt at the agent level. We
  // collapse our per-request instruction blocks into a single leading
  // ASSISTANT turn — the model treats it as committed prior context.
  // `cacheFirstSystemBlock` is kept for API compatibility (no-op on DO).
  async generateChat(options: {
    systemBlocks: string[];
    messages: LlmMessage[];
    maxTokens?: number;
    cacheFirstSystemBlock?: boolean;
  }): Promise<string | null> {
    const merged: LlmMessage[] = [];
    if (options.systemBlocks.length > 0) {
      merged.push({
        role: 'assistant',
        content: options.systemBlocks.join('\n\n'),
      });
    }
    merged.push(...options.messages);
    const response = await this.chat({
      messages: merged,
      maxTokens: options.maxTokens ?? 1024,
    });
    return response?.choices[0]?.message?.content ?? null;
  }

  // ─── Tool-use loop ───────────────────────────────────────────────────
  // OpenAI's tool format differs from Anthropic's:
  //   - Tools sent as `[{type:"function", function:{name, description, parameters}}]`
  //   - Tool calls come back on `message.tool_calls[]`
  //   - Tool results go back as `{role:"tool", tool_call_id, content}` messages
  // Behavior is identical to Anthropic: call → execute → result → repeat
  // until the model finishes (finish_reason !== "tool_calls").
  async runTools(options: {
    systemBlocks: string[];
    messages: LlmMessage[];
    tools: LlmTool[];
    handler: (
      name: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    maxIterations?: number;
    maxTokens?: number;
    cacheFirstSystemBlock?: boolean;
  }): Promise<{ finalText: string | null; transcript: LlmMessage[] }> {
    if (!this.enabled || !this.apiKey) {
      return { finalText: null, transcript: options.messages };
    }
    const {
      systemBlocks,
      tools,
      handler,
      maxIterations = 6,
      maxTokens = 1024,
    } = options;

    let messages: LlmMessage[] = [];
    if (systemBlocks.length > 0) {
      // Per-request instructions ride as a leading assistant turn — DO
      // Gradient owns the system role at the dashboard level.
      messages.push({
        role: 'assistant',
        content: systemBlocks.join('\n\n'),
      });
    }
    messages.push(...options.messages);

    for (let iter = 0; iter < maxIterations; iter++) {
      const response = await this.chat({
        messages,
        maxTokens,
        tools,
      });
      if (!response) return { finalText: null, transcript: messages };

      const choice = response.choices[0];
      if (!choice) return { finalText: null, transcript: messages };

      const assistantMessage = choice.message;
      messages = [...messages, assistantMessage];

      if (choice.finish_reason !== 'tool_calls') {
        return {
          finalText: assistantMessage.content ?? null,
          transcript: messages,
        };
      }

      const toolCalls = assistantMessage.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // finish_reason said tool_calls but none included — bail safely.
        return { finalText: null, transcript: messages };
      }

      // Execute each requested tool. Errors are surfaced to the model as
      // tool messages so it can recover.
      const toolMessages: LlmMessage[] = [];
      for (const call of toolCalls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(call.function.arguments || '{}');
        } catch {
          // Malformed JSON from the model. Pass through as-is so the model
          // can see the parse error in the next turn.
          parsedInput = {};
        }
        try {
          const result = await handler(call.function.name, parsedInput);
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content:
              typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (error) {
          this.logger.warn(
            `Tool ${call.function.name} threw: ${(error as Error).message}`,
          );
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({
              error: (error as Error).message || 'Tool execution failed.',
            }),
          });
        }
      }
      messages = [...messages, ...toolMessages];
    }

    this.logger.warn(`LLM tools loop hit maxIterations=${maxIterations}`);
    return { finalText: null, transcript: messages };
  }

  // ─── HTTP layer ──────────────────────────────────────────────────────

  private async chat(options: {
    messages: LlmMessage[];
    maxTokens?: number;
    tools?: LlmTool[];
    responseFormat?: 'text' | 'json_object';
  }): Promise<LlmChatResponse | null> {
    if (!this.enabled || !this.apiKey) return null;

    const payload: LlmCreateChatPayload = {
      model: this.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 1024,
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools }
        : {}),
      ...(options.responseFormat
        ? { response_format: { type: options.responseFormat } }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      this.logger.error(`LLM request failed: ${(error as Error).message}`);
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `LLM returned ${response.status}: ${body.slice(0, 500)}`,
      );
      return null;
    }
    const parsed = (await response.json()) as LlmChatResponse;
    if (parsed.usage) {
      const cached = parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;
      this.logger.debug(
        `LLM usage: prompt=${parsed.usage.prompt_tokens} completion=${parsed.usage.completion_tokens} cached=${cached}`,
      );
    }
    return parsed;
  }
}
