import { cn } from '@/lib/utils';
import '@/styles/globals.css';

export const metadata = {
  title: 'Ava Voice Assistant',
  description: 'Best Driving School AI voice assistant',
};

interface RootLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export async function RootLayout({ children, className }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning className={cn('scroll-smooth', className)}>
      <body className={cn('overflow-x-hidden antialiased')}>{children}</body>
    </html>
  );
}
