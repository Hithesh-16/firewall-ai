import {
  streamJSON,
  streamResponse,
  streamSse,
  toAsyncIterable,
} from "./stream.js";

import patchedFetch from "./node-fetch-patch.js";

import { fetchwithRequestOptions } from "./fetch.js";
import { extractFirewallMeta, extractScanHeaders, onScanResult } from "./scanHeaders.js";
import type { FirewallScanResult, ScanResultListener } from "./scanHeaders.js";

export {
  extractFirewallMeta,
  extractScanHeaders,
  fetchwithRequestOptions,
  onScanResult,
  patchedFetch,
  streamJSON,
  streamResponse,
  streamSse,
  toAsyncIterable,
};

export type { FirewallScanResult, ScanResultListener };
