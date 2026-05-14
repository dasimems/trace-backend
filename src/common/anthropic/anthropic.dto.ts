// https://docs.claude.com/en/api/messages

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicTextBlock[];
}

export interface AnthropicCreateMessagePayload {
  model: string;
  max_tokens: number;
  system?: AnthropicTextBlock[];
  messages: AnthropicMessage[];
  temperature?: number;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: 'text'; text: string } | { type: string; [key: string]: unknown }>;
  stop_reason: string;
  usage: AnthropicUsage;
}
