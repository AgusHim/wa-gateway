import { z } from "zod";

const envSchema = z.object({
    // WhatsApp
    WA_SESSION_ID: z.string().default("main-session"),

    // AI
    GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
    GEMINI_MODEL: z.string().default("gemini-2.5-flash-lite"),

    // Database
    DATABASE_URL: z.string().url("Invalid DATABASE_URL"),

    // Redis
    REDIS_URL: z.string().default("redis://localhost:6380"),

    // Dashboard Auth
    NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
    NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
    ADMIN_EMAIL: z.string().email("Invalid ADMIN_EMAIL"),
    ADMIN_PASSWORD: z.string().min(6, "ADMIN_PASSWORD must be at least 6 characters"),

    // App
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
        console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
        throw new Error("Invalid environment variables");
    }

    return parsed.data;
}

export const env = loadEnv();
