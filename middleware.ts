import { withAuth } from "next-auth/middleware";

export default withAuth({
    pages: {
        signIn: "/login",
    },
});

export const config = {
    matcher: [
        "/",
        "/monitor/:path*",
        "/conversations/:path*",
        "/users/:path*",
        "/config/:path*",
        "/tool-logs/:path*",
        "/analytics/:path*",
        "/qr/:path*",
    ],
};
