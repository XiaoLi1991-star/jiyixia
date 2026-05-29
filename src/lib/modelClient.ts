import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { ModelSettings } from '@/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionResult {
  content: string
  raw: unknown
}

interface ChatRequestBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  stream: boolean
  max_tokens?: number
  max_completion_tokens?: number
}

function joinUrl(baseUrl: string, requestPath: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, '')
  const path = requestPath.trim() || '/chat/completions'
  if (!trimmedBase) throw new Error('请先填写服务地址。')
  if (/\/chat\/completions\/?$/.test(trimmedBase) && path === '/chat/completions') return trimmedBase
  return `${trimmedBase}/${path.replace(/^\/+/, '')}`
}

function usesMiniMaxContract(settings: ModelSettings): boolean {
  const baseUrl = settings.baseUrl.toLowerCase()
  const model = settings.model.toLowerCase()
  return baseUrl.includes('minimax') || model.startsWith('minimax-')
}

function normalizeContentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const item = part as { text?: unknown; content?: unknown }
    return typeof item.text === 'string' ? item.text : typeof item.content === 'string' ? item.content : ''
  }).join('')
}

export function readChatContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }>
    message?: { content?: unknown }
    reply?: string
    output_text?: string
  }
  return normalizeContentText(data.choices?.[0]?.message?.content)
    || normalizeContentText(data.choices?.[0]?.delta?.content)
    || normalizeContentText(data.choices?.[0]?.text)
    || normalizeContentText(data.message?.content)
    || data.reply
    || data.output_text
    || ''
}

function buildRequestBody(settings: ModelSettings, messages: ChatMessage[]): ChatRequestBody {
  const maxTokensKey = usesMiniMaxContract(settings) ? 'max_completion_tokens' : 'max_tokens'
  return {
    model: settings.model.trim(),
    messages,
    temperature: settings.temperature <= 0 && usesMiniMaxContract(settings) ? 0.1 : settings.temperature,
    stream: false,
    [maxTokensKey]: settings.maxTokens
  }
}

function parseRawPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {}
  if (!value.trim()) return {}
  return JSON.parse(value)
}

function createResult(status: number, rawPayload: unknown): ChatCompletionResult {
  const raw = parseRawPayload(rawPayload)
  if (status < 200 || status >= 300) {
    const error = raw as { error?: { message?: string }; message?: string }
    throw new Error(error.error?.message || error.message || `模型请求失败：${status}`)
  }
  const content = readChatContent(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!content) throw new Error('模型返回为空。')
  return { content, raw }
}

async function requestWithFetch(url: string, apiKey: string, body: ChatRequestBody, timeoutMs: number): Promise<ChatCompletionResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(body)
    })
    return createResult(response.status, await response.text())
  } finally {
    window.clearTimeout(timeout)
  }
}

async function requestWithNativeHttp(url: string, apiKey: string, body: ChatRequestBody, timeoutMs: number): Promise<ChatCompletionResult> {
  const response = await withTimeout(() => CapacitorHttp.post({
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`
    },
    data: body,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
    responseType: 'json'
  }), timeoutMs)
  return createResult(response.status, response.data)
}

function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('模型请求超时。')), timeoutMs)
    Promise.resolve().then(run).then(
      value => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      error => {
        window.clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

export async function requestChatCompletion(settings: ModelSettings, apiKey: string, messages: ChatMessage[]): Promise<ChatCompletionResult> {
  if (!settings.model.trim()) throw new Error('请先填写模型名。')
  if (!apiKey.trim()) throw new Error('请先填写访问密钥。')

  try {
    const url = joinUrl(settings.baseUrl, settings.requestPath)
    const body = buildRequestBody(settings, messages)
    if (Capacitor.isNativePlatform()) return requestWithNativeHttp(url, apiKey, body, settings.timeoutMs)
    return requestWithFetch(url, apiKey, body, settings.timeoutMs)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('模型返回格式不正确。')
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('模型请求超时。')
    throw error
  }
}
