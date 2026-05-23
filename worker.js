export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Normalize root to index.html
    if (url.pathname === "/" || url.pathname === "") {
      const indexRequest = new Request(new URL("/index.html", request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }

    let response;
    try {
      response = await env.ASSETS.fetch(request);
    } catch {
      return new Response("Service temporarily unavailable", { status: 503 });
    }

    // Serve custom 404 page
    if (response.status === 404) {
      const notFoundRequest = new Request(new URL("/404.html", request.url), request);
      const notFoundResponse = await env.ASSETS.fetch(notFoundRequest);
      return new Response(notFoundResponse.body, {
        status: 404,
        headers: notFoundResponse.headers,
      });
    }

    // Pass through all other responses unchanged (headers set via _headers file)
    return response;
  },
};