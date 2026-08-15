import { RootLayout } from '@/components/root-layout';

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function Layout({ children }: RootLayoutProps) {
  return (
    <RootLayout className="bg-transparent">
      <div className="embed-shell">{children}</div>
    </RootLayout>
  );
}
