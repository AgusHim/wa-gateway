export type BusinessHoursConfig = {
    timezone: string;
    businessHoursStart: string;
    businessHoursEnd: string;
    businessDays: number[];
    outOfHoursAutoReplyEnabled: boolean;
    outOfHoursMessage: string;
};

function parseHourMinute(value: string): { hour: number; minute: number } {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return { hour: 0, minute: 0 };
    }

    const hour = Math.max(0, Math.min(23, Number(match[1])));
    const minute = Math.max(0, Math.min(59, Number(match[2])));
    return { hour, minute };
}

function getZonedDateParts(timezone: string, date: Date) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour12: false,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
    });

    const parts = formatter.formatToParts(date);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const weekdayRaw = (map.get("weekday") || "Mon").toLowerCase();

    const dayMap: Record<string, number> = {
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
        sun: 0,
    };

    return {
        weekday: dayMap[weekdayRaw.slice(0, 3)] ?? 1,
        hour: Number(map.get("hour") || 0),
        minute: Number(map.get("minute") || 0),
    };
}

function toMinutes(hour: number, minute: number): number {
    return hour * 60 + minute;
}

export function isWithinBusinessHours(config: BusinessHoursConfig, date: Date = new Date()): boolean {
    const zone = config.timezone?.trim() || "Asia/Jakarta";
    const parts = getZonedDateParts(zone, date);

    const allowedDays = config.businessDays && config.businessDays.length > 0
        ? config.businessDays
        : [1, 2, 3, 4, 5];
    if (!allowedDays.includes(parts.weekday)) {
        return false;
    }

    const start = parseHourMinute(config.businessHoursStart || "08:00");
    const end = parseHourMinute(config.businessHoursEnd || "20:00");
    const nowMinutes = toMinutes(parts.hour, parts.minute);
    const startMinutes = toMinutes(start.hour, start.minute);
    const endMinutes = toMinutes(end.hour, end.minute);

    if (startMinutes <= endMinutes) {
        return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }

    // Overnight window, e.g. 22:00 - 06:00
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

export function resolveOutOfHoursAutoReply(config: BusinessHoursConfig): string {
    return config.outOfHoursMessage?.trim()
        || "Terima kasih, pesan Anda sudah diterima. Tim kami akan membalas pada jam operasional.";
}
