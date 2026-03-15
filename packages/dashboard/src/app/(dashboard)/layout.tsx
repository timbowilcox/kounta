import { Sidebar } from "@/components/sidebar";
import { CommandBarProvider } from "@/components/command-bar-provider";
import { CommandBar } from "@/components/command-bar";
import { PostTransactionProvider } from "@/components/post-transaction-provider";
import { PostTransactionModal } from "@/components/post-transaction-modal";
import { NavigationProgress } from "@/components/navigation-progress";
import { NameCaptureModal } from "@/components/name-capture-modal";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CommandBarProvider>
      <PostTransactionProvider>
        <NavigationProgress />
        <div className="flex min-h-screen">
          <Sidebar />
          <main
            className="flex-1 page-content"
            style={{
              marginLeft: 220,
              padding: "32px 32px",
              maxWidth: 1200,
              minHeight: "100vh",
              position: "relative",
              zIndex: 1,
            }}
          >
            {children}
          </main>
          <CommandBar />
          <PostTransactionModal />
          <NameCaptureModal />
        </div>
      </PostTransactionProvider>
    </CommandBarProvider>
  );
}
