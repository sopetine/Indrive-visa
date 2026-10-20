export class ProductDefectError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductDefectError";
    this.classification = "product defect";
  }
}

export async function probeLiveWorker({ request, signal, fetchImpl = fetch }) {
  let response;
  let text;
  let data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl("https://visa-advisor.sopetine.workers.dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
    } catch (error) {
      if (attempt === 1) {
        throw new ProductDefectError(`retry after unrecognized response format failed before returning a usable report: ${error.message}`);
      }
      throw error;
    }
    try {
      text = await response.text();
    } catch (error) {
      if (attempt === 1) {
        throw new ProductDefectError(`retry after unrecognized response format failed while reading the response: ${error.message}`);
      }
      throw error;
    }
    try { data = JSON.parse(text); } catch {
      if (attempt === 1) throw new ProductDefectError(`retry did not return a usable report: response was not JSON (${text.slice(0, 300)})`);
      throw new Error(`payload unavailable: response was not JSON (${text.slice(0, 300)})`);
    }
    if (!response.ok && /unrecognized response format/i.test(data?.error || "")) {
      if (attempt === 0) continue;
      const error = new ProductDefectError(`unrecognized response format after retry: HTTP ${response.status}: ${data.error}`);
      error.httpStatus = response.status;
      throw error;
    }
    if (!response.ok) {
      if (attempt === 1) throw new ProductDefectError(`retry did not return a usable report: HTTP ${response.status}: ${data.error || text.slice(0, 300)}`);
      throw new Error(`provider/request unavailable: HTTP ${response.status}: ${data.error || text.slice(0, 300)}`);
    }
    if (!data || data.type !== "report" || typeof data.markdown !== "string" || !data.markdown.trim()) {
      if (attempt === 1) throw new ProductDefectError(`retry did not return a usable report: ${JSON.stringify(data).slice(0, 500)}`);
      throw new Error(`payload unavailable: expected a non-empty report; received ${JSON.stringify(data).slice(0, 500)}`);
    }
    return { response, text, data };
  }
}
