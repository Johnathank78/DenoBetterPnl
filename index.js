// ===== Binance proxy (Deno Deploy / Worker) =====

addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request));
});

/* ------------------------- CORS + Anti-cache ------------------------- */

function buildCORSHeaders(request, baseHeaders = {}) {
  const h = new Headers(baseHeaders || {});
  const origin = request.headers.get("origin") || "*";

  // CORS
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  const reqHdrs = request.headers.get("Access-Control-Request-Headers");
  h.set("Access-Control-Allow-Headers", reqHdrs || "Content-Type, X-MBX-APIKEY");

  // Réduire la charge des preflights
  h.set("Access-Control-Max-Age", "600");
  h.set("Vary", "Origin, Access-Control-Request-Headers, Access-Control-Request-Method");

  // Anti-cache partout (navigateur, SW, proxies)
  h.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  h.set("Pragma", "no-cache");
  h.set("Expires", "0");

  return h;
}

async function withCORS(responsePromise, request) {
  try {
    const resp = await responsePromise;
    const headers = buildCORSHeaders(request, resp.headers);
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    });
  } catch (err) {
    const body = JSON.stringify({ ok: false, message: String(err?.message || err) });
    return new Response(body, {
      status: 500,
      headers: buildCORSHeaders(request, { "Content-Type": "application/json" }),
    });
  }
}

function json(status, data, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildCORSHeaders(request, { "Content-Type": "application/json" }),
  });
}

/* --------------------------- Utils serveur --------------------------- */

const BINANCE = "https://api.binance.com";

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function joinQS(url, moreQS) {
  if (!moreQS) return url;
  return url + (url.includes("?") ? "&" : "?") + moreQS;
}

/* ----------------------------- Handlers ------------------------------ */

async function handle(request) {
  const url = new URL(request.url);

  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCORSHeaders(request) });
  }

  // Healthcheck (debug PWA)
  if (url.pathname === "/__health" && request.method === "GET") {
    return json(200, { ok: true, ts: Date.now() }, request);
  }

  // Public proxy (GET)
  if (url.pathname === "/proxyPublic" && request.method === "GET") {
    return withCORS(proxyPublic(request, url), request);
  }

  // Signed generic proxy (POST)  body: { apiKey, endpoint, queryString }
  if (url.pathname === "/proxySigned" && request.method === "POST") {
    return withCORS(proxySigned(request), request);
  }

  // Open orders (POST) body: { apiKey, queryString }
  if (url.pathname === "/proxyOpenOrders" && request.method === "POST") {
    return withCORS(proxyOpenOrders(request), request);
  }

  // Fiat orders (POST) body: { apiKey, queryString }
  if (url.pathname === "/proxyFiatOrders" && request.method === "POST") {
    return withCORS(proxyFiatOrders(request), request);
  }

  // Fiat payments (POST) body: { apiKey, queryString }
  if (url.pathname === "/proxyFiatPayments" && request.method === "POST") {
    return withCORS(proxyFiatPayments(request), request);
  }

  // ListenKey (create) (POST) body: { apiKey }
  if (url.pathname === "/listenKey" && request.method === "POST") {
    return withCORS(createListenKey(request), request);
  }

  // ListenKey keepAlive (PUT) body: { apiKey, listenKey }
  if (url.pathname === "/listenKey" && request.method === "PUT") {
    return withCORS(keepAlive(request), request);
  }

  // 404
  return new Response("Not found", {
    status: 404,
    headers: buildCORSHeaders(request, { "Content-Type": "text/plain" }),
  });
}

/* ---------------------------- Proxies REST --------------------------- */

// /proxyPublic?endpoint=/api/v3/time&symbol=BTCUSDC ...
async function proxyPublic(request, url) {
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint || !endpoint.startsWith("/")) {
    return json(400, { ok: false, message: "Missing or invalid 'endpoint'" }, request);
  }

  const forward = new URL(BINANCE + endpoint);
  // Copie toutes les query params sauf "endpoint"
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "endpoint") forward.searchParams.set(k, v);
  }

  const resp = await fetch(forward.toString(), {
    method: "GET",
  });
  // On propage tel quel (withCORS ajoutera les bons headers)
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

// body: { apiKey, endpoint, queryString }
async function proxySigned(request) {
  const { apiKey, endpoint, queryString } = await readJson(request);
  if (!apiKey || !endpoint || !endpoint.startsWith("/")) {
    return json(400, { ok: false, message: "Missing apiKey/endpoint" }, request);
  }
  const url = joinQS(BINANCE + endpoint, queryString || "");
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

// body: { apiKey, queryString }
async function proxyOpenOrders(request) {
  const { apiKey, queryString } = await readJson(request);
  if (!apiKey || !queryString) {
    return json(400, { ok: false, message: "Missing apiKey/queryString" }, request);
  }
  const url = joinQS(BINANCE + "/api/v3/openOrders", queryString);
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

// body: { apiKey, queryString }
async function proxyFiatOrders(request) {
  const { apiKey, queryString } = await readJson(request);
  if (!apiKey || !queryString) {
    return json(400, { ok: false, message: "Missing apiKey/queryString" }, request);
  }
  const url = joinQS(BINANCE + "/sapi/v1/fiat/orders", queryString);
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

// body: { apiKey, queryString }
async function proxyFiatPayments(request) {
  const { apiKey, queryString } = await readJson(request);
  if (!apiKey || !queryString) {
    return json(400, { ok: false, message: "Missing apiKey/queryString" }, request);
  }
  const url = joinQS(BINANCE + "/sapi/v1/fiat/payments", queryString);
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

/* --------------------------- ListenKey Spot -------------------------- */

// body: { apiKey }
async function createListenKey(request) {
  const { apiKey } = await readJson(request);
  if (!apiKey) return json(400, { ok: false, message: "Missing apiKey" }, request);

  const resp = await fetch(BINANCE + "/api/v3/userDataStream", {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
  });

  // Binance renvoie JSON { listenKey: "..." }
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}

// body: { apiKey, listenKey }
async function keepAlive(request) {
  const { apiKey, listenKey } = await readJson(request);
  if (!apiKey || !listenKey) {
    return json(400, { ok: false, message: "Missing apiKey/listenKey" }, request);
  }

  // IMPORTANT: PUT avec listenKey en query (pas de body)
  const url = BINANCE + "/api/v3/userDataStream?listenKey=" + encodeURIComponent(listenKey);
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "X-MBX-APIKEY": apiKey },
  });

  return new Response(await resp.text(), {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("Content-Type") || "application/json" },
  });
}
