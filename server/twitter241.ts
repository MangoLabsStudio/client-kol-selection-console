export type Twitter241Params = Record<string, string | number | boolean | undefined | null>;

export type Twitter241Client = {
  get(endpoint: string, params: Twitter241Params): Promise<unknown>;
};

const defaultBaseUrl = "https://twitter241.p.rapidapi.com";
const defaultHost = "twitter241.p.rapidapi.com";

export function createTwitter241ClientFromEnv(): Twitter241Client | null {
  const primaryKey = process.env.TWITTER241_RAPIDAPI_KEY?.trim();
  const fallbackKey = process.env.TWITTER241_RAPIDAPI_KEY_FALLBACK?.trim();
  const secondFallbackKey = process.env.TWITTER241_RAPIDAPI_KEY_FALLBACK_2?.trim();
  if (!primaryKey) return null;

  return new RapidApiTwitter241Client({
    baseUrl: process.env.TWITTER241_BASE_URL?.trim() || defaultBaseUrl,
    host: process.env.TWITTER241_RAPIDAPI_HOST?.trim() || defaultHost,
    keys: [primaryKey, fallbackKey, secondFallbackKey].filter((key): key is string => Boolean(key))
  });
}

class RapidApiTwitter241Client implements Twitter241Client {
  private activeKeyIndex = 0;

  constructor(
    private readonly options: {
      baseUrl: string;
      host: string;
      keys: string[];
    }
  ) {}

  async get(endpoint: string, params: Twitter241Params): Promise<unknown> {
    const url = new URL(endpoint, this.options.baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            "content-type": "application/json",
            "x-rapidapi-host": this.options.host,
            "x-rapidapi-key": this.options.keys[this.activeKeyIndex]
          }
        });

        if (response.status === 429 && this.switchKey()) continue;
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};

        if (!response.ok) {
          const message = getPayloadMessage(payload) || `Twitter241 request failed with HTTP ${response.status}`;
          if (isQuotaMessage(message) && this.switchKey()) continue;
          throw new Error(message);
        }

        const message = getPayloadMessage(payload);
        if (message && isQuotaMessage(message) && this.switchKey()) continue;

        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await wait(350 * 2 ** attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Twitter241 request failed");
  }

  private switchKey() {
    if (this.activeKeyIndex + 1 >= this.options.keys.length) return false;
    this.activeKeyIndex += 1;
    return true;
  }
}

function getPayloadMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("message" in payload)) return "";
  return String((payload as { message?: unknown }).message ?? "");
}

function isQuotaMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("quota") || normalized.includes("exceeded") || normalized.includes("too many requests");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
