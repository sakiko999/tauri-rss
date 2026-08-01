/**
 * Host capability surface — the seam between the web-standard data layer and
 * its runtime. See `types/platform.ts` for the contract.
 */
export type {
  PlatformHost,
  HttpBackend,
  HttpRequest,
  HttpResponse,
  HttpMethod,
  HttpResponseType,
  StorageBackend,
  JsBackend,
  Logger,
  LogLevel,
} from "../types/platform.ts"
