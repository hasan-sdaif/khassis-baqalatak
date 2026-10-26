import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const appFont = IBM_Plex_Sans_Arabic({
  variable: "--font-app-sans",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "خصص بقالتك — Khassis Baqalatak",
  description:
    "أدخل ميزانيتك وعادات أسرتك، فيقترح لك التطبيق خطة شراء بقالة كاملة بمنتجات وأحجام وأسعار مناسبة لك تحديداً — الأنسب لا الأرخص ولا الأغلى. قاعدة بيانات مفتوحة لـ 39,831 منتجاً من 37 متجراً بحرينياً.",
  keywords: ["بقالة", "ميزانية", "البحرين", "grocery", "budget", "Bahrain", "خطة", "تسوق"],
  applicationName: "خصص بقالتك",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "خصص بقالتك",
    description: "خطة بقالة ذكية بميزانيتك — الأنسب لا الأرخص",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#171c17" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${appFont.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
      </body>
    </html>
  );
}
