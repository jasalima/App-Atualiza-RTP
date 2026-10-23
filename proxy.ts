import { auth } from '@/lib/auth';

export default auth.middleware({ loginUrl: '/' });

export const config = {
  matcher: ['/api/reports/:path*', '/api/plans/:path*', '/api/storage/:path*']
};
