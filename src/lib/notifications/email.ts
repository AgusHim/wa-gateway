type SendTenantEmailInput = {
    to: string;
    subject: string;
    text: string;
};

export async function sendTenantEmail(input: SendTenantEmailInput) {
    // Placeholder transport for local/dev deployment.
    // Integrate with SMTP/provider in production.
    console.info("[tenant-email]", {
        to: input.to,
        subject: input.subject,
        text: input.text,
    });
}
