import type { HttpClient, HttpResponse } from '../../src/platform.js'

export interface RecordedRequest {
  method: string
  url: string
  body: string | undefined
  headers: Record<string, string>
}

type Responder = (req: RecordedRequest) => HttpResponse | Promise<HttpResponse>

export class FakeHttp implements HttpClient {
  readonly requests: RecordedRequest[] = []
  #responders: Responder[] = []
  #fallback: HttpResponse = { status: 200, body: '{}' }

  /** Queues one response, consumed by the next matching request. */
  enqueue(...responses: (HttpResponse | Responder)[]): void {
    for (const r of responses) {
      this.#responders.push(typeof r === 'function' ? r : () => r)
    }
  }

  setFallback(response: HttpResponse): void {
    this.#fallback = response
  }

  async request(init: {
    method: 'GET' | 'POST' | 'PUT'
    url: string
    headers?: Readonly<Record<string, string>>
    body?: string
  }): Promise<HttpResponse> {
    const recorded: RecordedRequest = {
      method: init.method,
      url: init.url,
      body: init.body,
      headers: { ...(init.headers ?? {}) },
    }
    this.requests.push(recorded)

    const responder = this.#responders.shift()
    return responder === undefined ? this.#fallback : responder(recorded)
  }
}

export const json = (status: number, value: unknown): HttpResponse => ({
  status,
  body: JSON.stringify(value),
})
