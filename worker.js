export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      const indexRequest = new Request(new URL("/index.html", request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }

    const response = await env.ASSETS.fetch(request);

    if (response.status === 404) {
      const notFoundRequest = new Request(new URL("/404.html", request.url), request);
      const notFoundResponse = await env.ASSETS.fetch(notFoundRequest);
      return new Response(notFoundResponse.body, {
        status: 404,
        headers: notFoundResponse.headers,
      });
    }

    return response;
  },
};
