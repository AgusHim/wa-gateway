"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type ConnectionPayload = { status: "open" | "close" | "connecting"; message?: string };

function connectionText(status: ConnectionPayload["status"]) {
    if (status === "open") return "Connected";
    if (status === "connecting") return "Connecting...";
    return "Disconnected";
}

export default function QrScannerPage() {
    const [qrValue, setQrValue] = useState("");
    const [status, setStatus] = useState<ConnectionPayload["status"]>("close");
    const [isResetting, setIsResetting] = useState(false);

    useEffect(() => {
        const source = new EventSource("/api/sse");

        source.addEventListener("qr", (event) => {
            const data = JSON.parse(event.data) as { qr: string };
            setQrValue(data.qr);
        });

        source.addEventListener("connection-update", (event) => {
            const payload = JSON.parse(event.data) as ConnectionPayload;
            setStatus(payload.status);
        });

        source.onerror = () => {
            setStatus("close");
        };

        return () => {
            source.close();
        };
    }, []);

    useEffect(() => {
        let active = true;

        const loadStatus = async () => {
            try {
                const res = await fetch("/api/wa/status", { cache: "no-store" });
                const data = (await res.json()) as { status?: ConnectionPayload["status"] };
                if (active && data.status) {
                    setStatus(data.status);
                }
            } catch {
                if (active) {
                    setStatus("close");
                }
            }
        };

        loadStatus();
        const timer = setInterval(loadStatus, 5000);

        return () => {
            active = false;
            clearInterval(timer);
        };
    }, []);

    const handleResetSession = async () => {
        setIsResetting(true);
        setQrValue("");
        setStatus("connecting");

        try {
            await fetch("/api/wa/reset-session", { method: "POST" });
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <section className="space-y-4">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">QR Scanner</h1>
                <p className="text-sm text-slate-500">Scan QR ini dari WhatsApp untuk menghubungkan akun bot.</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">
                        Status koneksi: <span className="font-semibold text-slate-900">{connectionText(status)}</span>
                    </p>
                    <button
                        type="button"
                        onClick={handleResetSession}
                        disabled={isResetting}
                        className="rounded-md bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isResetting ? "Memproses..." : "Hapus Session & Scan Ulang"}
                    </button>
                </div>

                {qrValue ? (
                    <QRCodeSVG
                        value={qrValue}
                        size={300}
                        className="h-[300px] w-[300px] rounded border border-slate-200"
                    />
                ) : (
                    <div className="flex h-[300px] w-[300px] items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500">
                        Menunggu QR baru...
                    </div>
                )}

                <p className="mt-4 text-xs text-slate-500">
                    Jika QR expired, tunggu beberapa detik. Halaman akan auto-refresh saat event QR baru masuk.
                </p>
            </div>
        </section>
    );
}
