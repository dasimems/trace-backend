// OpenAI-compatible Chat Completions wire shapes. Compatible with any
// provider that implements POST /v1/chat/completions — OpenAI, OpenRouter,
// Groq, Together, Anthropic's OpenAI compat shim, local Ollama, etc.

// JSON-schema tool definition. Matches OpenAI's `tools` field.
export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// `content` is null when the assistant returns only tool_calls.
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  // Present on assistant messages that requested tools.
  tool_calls?: LlmToolCall[];
  // Present on `role: "tool"` messages — links back to the originating call.
  tool_call_id?: string;
  // Optional name for tool messages (some providers want it).
  name?: string;
}

export interface LlmCreateChatPayload {
  model: string;
  messages: LlmMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: LlmTool[];
  // Forces structured JSON output (supported by OpenAI, many others).
  response_format?: { type: 'text' | 'json_object' };
}

export interface LlmChoice {
  index: number;
  message: LlmMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  // Some providers (OpenAI) report cache hits — informational only.
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

export interface LlmChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: LlmChoice[];
  usage?: LlmUsage;
}
