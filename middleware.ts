import { rewrite } from '@vercel/edge'
import builtInApiPaths from './built-in-api-paths'

const hosts = (process.env.HOSTS ?? 'clubs.place')
  .split(',')
  .map((x) => x.trim())

export const config = {
  matcher: ['/((?!assets|chunks|_vercel|[\\w-]+\\.\\w+).*)'],
}

const redirects = [
  ...hosts.map((host) => ({
    host,
    matchers: [
      '/',
      new RegExp('^/(plugins|dev-tokens|blog|post|pricing)(|/.*)$'),
    ],
    destination: 'https://www.clubs.place',
  })),
  {
    host: 'temples.clubs.stakes.social',
    matchers: undefined,
    destination: 'https://temples.clubs.place',
  },
  {
    host: 'kougenji.clubs.stakes.social',
    matchers: undefined,
    destination: 'https://kougenji.clubs.place',
  },
]

export default function middleware(req: Request) {
  const url = new URL(req.url)

  const matchToRedirects = redirects.find(
    ({ host, matchers }) =>
      host === url.host &&
      (matchers
        ? matchers.some((matcher) =>
            typeof matcher === 'string'
              ? matcher === url.pathname
              : matcher.test(url.pathname),
          )
        : true),
  )

  if (matchToRedirects) {
    return Response.redirect(
      new URL(
        `${url.pathname}${url.search ? url.search : ''}`,
        matchToRedirects.destination,
      ),
    )
  }

  const hostnames = url.host.split('.') ?? []
  const [tenant] = hostnames
  const html =
    req.headers.get('accept')?.includes('text/html') ||
    url.pathname
      .split('/')
      .slice(-1)
      .every((p) => !/\..+$/.test(p))
  const api =
    url.pathname.startsWith('/api/') &&
    builtInApiPaths.every((p) => !url.pathname.startsWith(p))

  const primaryHost =
    hosts.find((h) => url.host === h) ?? hosts.find((h) => url.host.endsWith(h))

  if ((html || api) && primaryHost && url.host !== primaryHost) {
    const pathname = `/sites_/${tenant}${url.pathname}`
    const destination = new URL(pathname, url.origin)
    return rewrite(destination, {
      headers: { 'x-rewritten-url': destination.href },
    })
  }

  // return next()
}
