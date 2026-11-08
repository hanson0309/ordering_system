export const allowedPublicPath = /^\/[^/]+\/menu\/[^/]+\/[^/]+(?:\/(?:cart|order\/[^/]+))?\/?$/

export const onRequest: PagesFunction = async ({ request, next }) => {
  const pathname = new URL(request.url).pathname

  if (
    pathname.startsWith('/api/') ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname.startsWith('/assets/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    allowedPublicPath.test(pathname)
  ) {
    return next()
  }

  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
