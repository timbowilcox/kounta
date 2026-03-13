import { Sidebar } from "@/components/sidebar";
import { CommandBarProvider } from "@/components/command-bar-provider";
import { CommandBar } from "@/components/command-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CommandBarProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main
          className="flex-1"
          style={{
            marginLeft: 260,
            padding: "40px 48px",
            maxWidth: 1200,
          }}
        >
          {children}
        </main>
        <CommandBar />
      </div>
    </CommandBarProvider>
  );
}
