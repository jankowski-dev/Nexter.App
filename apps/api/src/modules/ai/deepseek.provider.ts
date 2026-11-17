import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { env } from '../../shared/config/env';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: AiMessage[];
  jsonMode?: boolean;
}

export interface AiResponse {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string; reasoning_content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

@Injectable()
export class DeepSeekProvider {
  async complete(input: AiRequest): Promise<AiResponse> {
    const base = (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
    let response: Response;

    try {
      response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException({
          code: 'AI_PROVIDER_ERROR',
          message: 'DeepSeek не ответил за 60 секунд',
        });
      }
      throw new BadGatewayException({
        code: 'AI_PROVIDER_ERROR',
        message: 'Не удалось подключиться к DeepSeek',
      });
    }

    const payload = (await response.json().catch(() => ({}))) as DeepSeekResponse;

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException({
        code: 'AI_UNAUTHORIZED',
        message: 'DeepSeek отклонил API-ключ',
      });
    }
    if (response.status === 429) {
      throw new HttpException(
        {
          code: 'AI_RATE_LIMITED',
          message: 'DeepSeek временно ограничил запросы',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'AI_PROVIDER_ERROR',
        message: payload.error?.message?.slice(0, 300) ?? `DeepSeek HTTP ${response.status}`,
      });
    }

    const choice = payload.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      const truncated =
        choice?.finish_reason === 'length' || Boolean(choice?.message?.reasoning_content);
      throw new ServiceUnavailableException({
        code: 'AI_INVALID_RESPONSE',
        message: truncated
          ? 'DeepSeek израсходовал лимит токенов на рассуждение. Увеличьте максимум токенов ответа.'
          : 'DeepSeek вернул пустой ответ',
      });
    }

    return {
      content,
      promptTokens: payload.usage?.prompt_tokens ?? null,
      completionTokens: payload.usage?.completion_tokens ?? null,
    };
  }
}
