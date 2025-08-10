import "./globals.css";
import { AuthProvider } from "./contexts/AuthContext";

export const metadata = { 
  title: "Scozo – Netball Scorer",
  description: "Professional netball scoring made simple and intuitive",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ScoZo"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#3b82f6"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ScoZo" />
      </head>
      <body className="antialiased">
        <AuthProvider>
          <div className="min-h-dvh flex flex-col">
            <div className="flex-1">{children}</div>
            <footer className="text-center py-2 text-xs text-white bg-gradient-to-r from-blue-900 to-purple-900 border-t border-white/20">
              ScoZo 4.0. Made in Adelaide
            </footer>
          </div>
        </AuthProvider>
        
        {/* PWA Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js')
                    .then(function(registration) {
                      console.log('SW registered: ', registration);
                    })
                    .catch(function(registrationError) {
                      console.log('SW registration failed: ', registrationError);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
