// Probe for a running Meterless Runtime (Nightshift) the same way the provider contract says:
// ports 8088/8090/8787/11434 on 127.0.0.1, localhost and [::1]; GET /v1/models decides the state.
import { loadEnv } from "../src/env.ts";
import { autoDetect, probe, normalizeBaseUrl, parseConnectLink } from "../src/llm/meterless.ts";
loadEnv();
const link = process.env.METERLESS_CONNECT_LINK ? parseConnectLink(process.env.METERLESS_CONNECT_LINK) : null;
const token = link?.token ?? process.env.METERLESS_RUNTIME_TOKEN ?? "";
if (link || process.env.METERLESS_BASE_URL) {
  const base = normalizeBaseUrl(link?.baseUrl ?? process.env.METERLESS_BASE_URL!);
  console.log(base, await probe(base, token));
} else {
  const d = await autoDetect(token || "probe");
  console.log(d ?? "Meterless Runtime not found. Install Nightshift (macOS/Windows), open Connect, paste the connect link into METERLESS_CONNECT_LINK.");
}
