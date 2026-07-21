import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const REQUEST_ID_HEADER = 'x-request-id';

function resolveOrCreateRequestId(request: NextRequest): string {
  const existing =
    request.headers.get(REQUEST_ID_HEADER) ||
    request.headers.get('x-correlation-id');
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  return crypto.randomUUID();
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = resolveOrCreateRequestId(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set('x-correlation-id', requestId);

  if (pathname.startsWith('/dashboard')) {
    const hasAuth = request.cookies.get('gpuvietnam-auth')?.value === '1';
    if (!hasAuth) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const redirect = NextResponse.redirect(loginUrl);
      redirect.headers.set(REQUEST_ID_HEADER, requestId);
      return redirect;
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set('x-correlation-id', requestId);
  return response;
}

export const config = {
  matcher: ['/dashboard', '/dashboard/:path*', '/api/:path*'],
};
