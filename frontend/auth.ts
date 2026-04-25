// frontend/auth.ts
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // Here, we will eventually call your FastAPI backend to verify the admin
        // For now, return a mock admin to keep the prototype moving
        if (credentials?.email === "admin@civiclink.in" && credentials?.password === "hackathon2026") {
          return { id: "1", name: "Super Admin", email: "admin@civiclink.in" };
        }
        return null;
      }
    })
  ],
  pages: {
    signIn: '/admin/login',
  },
  session: { strategy: "jwt" },
});