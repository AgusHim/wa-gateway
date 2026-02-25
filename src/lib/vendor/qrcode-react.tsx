"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type QRCodeSVGProps = {
    value: string;
    size?: number;
    className?: string;
};

export function QRCodeSVG({ value, size = 300, className }: QRCodeSVGProps) {
    const [dataUrl, setDataUrl] = useState("");

    useEffect(() => {
        let active = true;

        const generate = async () => {
            if (!value) {
                setDataUrl("");
                return;
            }

            try {
                const url = await QRCode.toDataURL(value, {
                    width: size,
                    margin: 2,
                });
                if (active) setDataUrl(url);
            } catch {
                if (active) setDataUrl("");
            }
        };

        generate();

        return () => {
            active = false;
        };
    }, [value, size]);

    if (!dataUrl) {
        return (
            <div
                className={className}
                style={{ width: size, height: size }}
            />
        );
    }

    return (
        <Image
            src={dataUrl}
            alt="QR Code"
            width={size}
            height={size}
            className={className}
            unoptimized
        />
    );
}
