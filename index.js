addEventListener("fetch", event => {
  event.respondWith(handle(event.request))
})

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
}

async function handle(request) {
  const url = new URL(request.url)

  // 1) Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    })
  }

  // 2) Public REST proxy
  if (url.pathname === "/proxyPublic" && request.method === "GET") {
    return withCORS(proxyPublic(request))
  }

  // 3) Signed‐proxy endpoints
  if (url.pathname === "/listenKey" && request.method === "POST") {
    return withCORS(createListenKey(request))
  }
  if (url.pathname === "/listenKey" && request.method === "PUT") {
    return withCORS(keepAlive(request))
  }
  if (url.pathname === "/proxySigned" && request.method === "POST") {
    return withCORS(proxySigned(request))
  }

  if (url.pathname === "/proxyFiatOrders" && request.method === "POST") {
    return withCORS(proxyFiatOrders(request));
  }

  if (url.pathname === "/proxyFiatPayments" && request.method === "POST") {
    return withCORS(proxyFiatPayments(request));
  }

  if (url.pathname === "/proxyOpenOrders" && request.method === "POST") {
    return withCORS(proxyOpenOrders(request));
  }

  // 4) Not found
  return new Response("Not found", {
    status: 404,
    headers: CORS_HEADERS
  })
}

// Helper to wrap any Response/Promise<Response> with CORS headers
async function withCORS(responsePromise) {
  const resp = await responsePromise
  // Clone headers so we can add our CORS entries
  const newHeaders = new Headers(resp.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(k, v)
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: newHeaders
  })
}

//
//  PUBLIC‐REST PROXY
//
async function proxyPublic(request) {
  const url = new URL(request.url)
  const endpoint = url.searchParams.get("endpoint")
  if (!endpoint) {
    return new Response(
      JSON.stringify({ error: "missing `endpoint` parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  // Rebuild query string (all other params)
  url.searchParams.delete("endpoint")
  const qs = url.searchParams.toString()
  const target = `https://api.binance.com${endpoint}${qs ? `?${qs}` : ""}`

  const resp = await fetch(target, { method: "GET" })
  const body = await resp.text()
  return new Response(body, {
    status: resp.status,
    headers: { "Content-Type": "application/json" }
  })
}

async function createListenKey(request) {
  const { apiKey } = await request.json()
  const resp = await fetch("https://api.binance.com/api/v3/userDataStream", {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey }
  })
  const body = await resp.text()
  return new Response(body, {
    status: resp.status,
    headers: { "Content-Type": "application/json" }
  })
}

async function keepAlive(request) {
  const { apiKey, listenKey } = await request.json();
  const resp = await fetch(`https://api.binance.com/api/v3/userDataStream?listenKey=${encodeURIComponent(listenKey)}`, {
    method: "PUT",
    headers: { "X-MBX-APIKEY": apiKey }
  });
  return new Response('{"ok":true}', {
    status: resp.ok ? 200 : resp.status,
    headers: { "Content-Type": "application/json" }
  });
}

async function proxySigned(request) {
  const { apiKey, endpoint, queryString } = await request.json()
  const url = `https://api.binance.com${endpoint}?${queryString}`
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey }
  })
  const json = await resp.text()
  return new Response(json, {
    status: resp.status,
    headers: { "Content-Type": "application/json" }
  })
}

async function proxyFiatOrders(request) {
  const { apiKey, queryString } = await request.json();

  // Endpoint is signed → needs the query-string you built client-side
  const url = `https://api.binance.com/sapi/v1/fiat/orders?${queryString}`;

  const resp = await fetch(url, {
    method  : "GET",
    headers : { "X-MBX-APIKEY": apiKey }
  });

  const body = await resp.text();
  return new Response(body, {
    status  : resp.status,
    headers : { "Content-Type": "application/json" }
  });
}

async function proxyFiatPayments(request) {
  const { apiKey, queryString } = await request.json();   // signed QS comes from browser
  const url  = `https://api.binance.com/sapi/v1/fiat/payments?${queryString}`;

  const resp = await fetch(url, {
    method : "GET",
    headers: { "X-MBX-APIKEY": apiKey }
  });

  return new Response(await resp.text(), {
    status : resp.status,
    headers: { "Content-Type": "application/json" }
  });
}

async function proxyOpenOrders(request) {
  const { apiKey, queryString } = await request.json();          // signed QS arrives from the client
  const url  = `https://api.binance.com/api/v3/openOrders?${queryString}`;

  const resp = await fetch(url, {
    method : "GET",
    headers: { "X-MBX-APIKEY": apiKey }
  });

  return new Response(await resp.text(), {
    status : resp.status,
    headers: { "Content-Type": "application/json" }
  });
}
