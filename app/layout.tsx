import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '昼食会計アプリ', description: '昼食の注文・会計管理' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
