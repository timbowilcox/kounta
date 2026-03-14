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
    async jwt({ token, account, profile }) {
      // On initial sign-in, provision the user in the Kounta API
      if (account && profile) {
        const provider = account.provider;
        const providerId = String(account.providerAccountId);
        const email = token.email ?? `${provider}-${providerId}@kounta.internal`;

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
      return session;
    },
  },
});
