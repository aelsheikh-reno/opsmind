import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import UploadProvider from "./contexts/UploadContext";
import EmailNotifier from "./components/EmailNotifier";
import { MobileMenuProvider } from "./contexts/MobileMenuContext";
import { BackgroundTasksProvider } from "./contexts/BackgroundTasksContext";
import DemoControls from "./components/DemoControls";
import NavigationProgress from "./components/NavigationProgress";
import FxRatesToast from "./components/FxRatesToast";
import PresenceHeartbeat from "./components/PresenceHeartbeat";

export const metadata: Metadata = {
  title: "OpsMind",
  description: "Operational intelligence platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-surface-1 text-gray-900 antialiased" suppressHydrationWarning>
        <NavigationProgress />
        <BackgroundTasksProvider>
          <MobileMenuProvider>
            <UploadProvider>
              {children}
            </UploadProvider>
          </MobileMenuProvider>
        </BackgroundTasksProvider>
        {process.env.IS_DEMO === "true" && <DemoControls />}
        <Toaster position="bottom-right" richColors closeButton />
        <FxRatesToast />
        <EmailNotifier />
        <PresenceHeartbeat />
      </body>
    </html>
  );
}
