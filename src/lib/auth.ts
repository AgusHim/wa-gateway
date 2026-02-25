import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
    session: { strategy: "jwt" },
    pages: {
        signIn: "/login",
    },
    providers: [
        CredentialsProvider({
            name: "Admin Login",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const adminEmail = process.env.ADMIN_EMAIL;
                const adminPassword = process.env.ADMIN_PASSWORD;

                if (!adminEmail || !adminPassword) {
                    console.error("[Auth] ADMIN_EMAIL or ADMIN_PASSWORD is not configured");
                    return null;
                }

                if (
                    credentials?.email === adminEmail
                    && credentials?.password === adminPassword
                ) {
                    return {
                        id: "admin",
                        name: "Dashboard Admin",
                        email: adminEmail,
                    };
                }

                return null;
            },
        }),
    ],
    secret: process.env.NEXTAUTH_SECRET,
};
