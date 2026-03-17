import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiSession";
import { configRepo } from "@/lib/db/configRepo";
import {
    evaluateInstagramAutoReplyRule,
    getWorkspaceInstagramAutoReplyRules,
} from "@/lib/integrations/instagram/ruleConfig";

export const runtime = "nodejs";

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
    const auth = await requireApiSession("read");
    if (!auth.ok) {
        return auth.response;
    }

    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return NextResponse.json({ success: false, message: "Invalid JSON payload" }, { status: 400 });
    }

    const eventTypeRaw = readString(payload.eventType).toLowerCase();
    const eventType = eventTypeRaw === "instagram-comment" ? "instagram-comment" : "instagram-dm";
    const messageText = readString(payload.messageText);

    if (!messageText) {
        return NextResponse.json({ success: false, message: "messageText is required" }, { status: 400 });
    }

    const [rules, botConfig] = await Promise.all([
        getWorkspaceInstagramAutoReplyRules(auth.context.workspaceId),
        configRepo.getBotConfig(auth.context.workspaceId),
    ]);

    const evaluation = evaluateInstagramAutoReplyRule({
        eventType,
        messageText,
        rules,
        businessHours: {
            timezone: botConfig.timezone,
            businessHoursStart: botConfig.businessHoursStart,
            businessHoursEnd: botConfig.businessHoursEnd,
            businessDays: botConfig.businessDays,
            outOfHoursAutoReplyEnabled: botConfig.outOfHoursAutoReplyEnabled,
            outOfHoursMessage: botConfig.outOfHoursMessage,
        },
    });

    return NextResponse.json({
        success: true,
        data: {
            eventType,
            rules,
            evaluation,
        },
    });
}
