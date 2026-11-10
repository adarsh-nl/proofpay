import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';

import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { parseRole, ROLE_COOKIE } from '@/lib/role';
import { cn } from '@/lib/utils';

import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

const DESCRIPTION =
  'ProofPay holds a payment with PayPal and only releases it when AI checks the before/after photos against the acceptance criteria. Human approval for every partial payment.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'ProofPay — vision-verified escrow on PayPal',
    template: '%s · ProofPay',
  },
  description: DESCRIPTION,
  applicationName: 'ProofPay',
  openGraph: {
    type: 'website',
    siteName: 'ProofPay',
    title: 'ProofPay — vision-verified escrow on PayPal',
    description: DESCRIPTION,
    url: '/',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ProofPay — money moves when the camera says the job is done.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProofPay — vision-verified escrow on PayPal',
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const role = parseRole(cookieStore.get(ROLE_COOKIE)?.value);

  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <TooltipProvider>
          <Header role={role} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <Toaster position="top-center" richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
