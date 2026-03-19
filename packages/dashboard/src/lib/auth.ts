import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { provisionUser } from "./provision";

declare module "next-auth" {
  interface Session {
    apiKey: string;
    ledgerId: string;
    userId: string;
    needsTemplate: boolean;
    needsOnboarding: boolean;
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, profile, trigger, session: updateData }) {
      // Handle session update (e.g. display name change, onboarding complete)
      if (trigger === "update" && updateData) {
        const data = updateData as Record<string, unknown>;
        if (data.name && typeof data.name === "string") {
          token.name = data.name;
        }
        if (data.needsOnboarding === false) {
          token.needsOnboarding = false;
        }
        if (data.needsTemplate === false) {
          token.needsTemplate = false;
        }
        // Allow switching ledger/apiKey from session update
        if (data.ledgerId && typeof data.ledgerId === "string") {
          token.ledgerId = data.ledgerId;
        }
        if (data.apiKey && typeof data.apiKey === "string") {
          token.apiKey = data.apiKey;
        }
        return token;
      }

      // Retry provisioning on subsequent requests if initial provision failed
      // (token exists but has no apiKey — user is authenticated but broken)
      if (!account && !profile && token.email && !token.apiKey) {
        console.log("[auth] Retrying provision for user:", token.email);
        try {
          const result = await provisionUser({
            email: token.email,
            name: (token.name as string) ?? "Kounta User",
            authProvider: (token.authProvider as string) ?? "unknown",
            authProviderId: (token.authProviderId as string) ?? (token.sub ?? "unknown"),
          });
          token.apiKey = result.apiKey;
          token.ledgerId = result.ledgerId;
          token.userId = result.userId;
          token.needsTemplate = result.needsTemplate;
          token.needsOnboarding = result.needsOnboarding;
        } catch (err) {
          console.error("[auth] Provision retry failed:", err);
        }
      }

      // On initial sign-in, provision the user in the Kounta API
      if (account && profile) {
        const provider = account.provider;
        const providerId = String(account.providerAccountId);
        const email = token.email ?? `${provider}-${providerId}@kounta.internal`;

        // Persist provider info on token for retry logic
        token.authProvider = provider;
        token.authProviderId = providerId;

        // Capture the real display name from OAuth profile
        // GitHub: profile.name (can be null), fallback to profile.login
        // Google: profile.name, or given_name + family_name
        const profileAny = profile as Record<string, unknown>;
        const oauthName =
          (profileAny.name as string) ??
          (profileAny.login as string) ??
          email.split("@")[0];
        const name = oauthName || "Kounta User";
        token.name = name;

        try {
          const result = await provisionUser({
            email,
            name,
            authProvider: provider,
            authProviderId: providerId,
          });

          token.apiKey = result.apiKey;
          token.ledgerId = result.ledgerId;
          token.userId = result.userId;
          token.needsTemplate = result.needsTemplate;
          token.needsOnboarding = result.needsOnboarding;
        } catch (err) {
          console.error("[auth] Provision failed:", err);
          // If provision fails, mark as needing onboarding so the user
          // doesn't land on a broken dashboard with no API key
          token.needsOnboarding = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = token as any;
      session.apiKey = (t.apiKey as string) ?? "";
      session.ledgerId = (t.ledgerId as string) ?? "";
      session.userId = (t.userId as string) ?? "";
      session.needsTemplate = (t.needsTemplate as boolean) ?? false;
      session.needsOnboarding = (t.needsOnboarding as boolean) ?? false;

      // Override with cookie values when user has switched ledgers.
      // This ensures every function that calls auth() gets the correct
      // API key scoped to the active ledger — not the original provisioned one.
      try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        const apiKeyOverride = cookieStore.get("kounta_active_api_key")?.value;
        const ledgerOverride = cookieStore.get("kounta_active_ledger")?.value;
        if (apiKeyOverride) session.apiKey = apiKeyOverride;
        if (ledgerOverride) session.ledgerId = ledgerOverride;
      } catch {
        // cookies() not available in some contexts (e.g. middleware) — use JWT values
      }

      return session;
    },
  },
});
